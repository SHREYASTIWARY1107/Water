-- =============================================================================
-- Web Push: server-side reminders that arrive even when the app is closed
-- (required for iPhone, where iOS suspends web apps in the background).
--
-- Flow: pg_cron (every minute) -> edge function `send-reminders`
--       -> claim_due_push_reminders() picks due users atomically
--       -> encrypted Web Push to each of the user's subscriptions.
-- Secrets (VAPID private key, cron secret) live in Supabase Vault and never
-- leave the database / edge runtime.
-- =============================================================================

-- Server-side schedule state on reminder_settings
alter table public.reminder_settings
  add column if not exists resumed_at       timestamptz,
  add column if not exists last_reminded_at timestamptz,
  add column if not exists snooze_until     timestamptz,
  add column if not exists snoozed_at       timestamptz;

-- -----------------------------------------------------------------------------
-- push_subscriptions: one row per browser/device push endpoint
-- -----------------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  endpoint        text not null unique check (endpoint like 'https://%' and char_length(endpoint) <= 2048),
  p256dh          text not null check (char_length(p256dh) between 40 and 200),
  auth            text not null check (char_length(auth) between 10 and 100),
  -- Lets the service worker act on notification buttons (log / snooze) without a session.
  action_token    text not null default encode(extensions.gen_random_bytes(24), 'hex'),
  user_agent      text check (user_agent is null or char_length(user_agent) <= 512),
  created_at      timestamptz not null default now(),
  last_success_at timestamptz,
  failure_count   integer not null default 0
);

create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

create policy "push_select_own" on public.push_subscriptions
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "push_delete_own" on public.push_subscriptions
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.push_subscriptions from anon, authenticated;
-- Clients never read action_token; they register/unregister via the RPCs below.
grant select (id, endpoint, user_agent, created_at, last_success_at) on public.push_subscriptions to authenticated;
grant delete on public.push_subscriptions to authenticated;

-- Register (or move) this browser's subscription to the signed-in user.
create or replace function public.register_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  -- An endpoint belongs to one browser profile; if another account used it before, take it over.
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id <> v_uid;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (v_uid, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 512))
  on conflict (endpoint) do update
    set p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent, failure_count = 0
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.unregister_push_subscription(p_endpoint text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
$$;

revoke all on function public.register_push_subscription(text, text, text, text) from public, anon;
revoke all on function public.unregister_push_subscription(text) from public, anon;
grant execute on function public.register_push_subscription(text, text, text, text) to authenticated;
grant execute on function public.unregister_push_subscription(text) to authenticated;

-- -----------------------------------------------------------------------------
-- Secrets in Vault
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'hydrate_cron_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'hydrate_cron_secret',
                                'Shared secret between pg_cron and the send-reminders edge function');
  end if;
end $$;

-- Public VAPID key for browsers (safe to expose). Null until the edge function generates keys.
create or replace function public.get_vapid_public_key()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'hydrate_vapid_public' limit 1;
$$;
revoke all on function public.get_vapid_public_key() from public, anon;
grant execute on function public.get_vapid_public_key() to authenticated;

-- Service-role only: full push config for the edge function.
create or replace function public.hydrate_push_config()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'cron_secret',  (select decrypted_secret from vault.decrypted_secrets where name = 'hydrate_cron_secret' limit 1),
    'vapid_public', (select decrypted_secret from vault.decrypted_secrets where name = 'hydrate_vapid_public' limit 1),
    'vapid_private_jwk', (select decrypted_secret from vault.decrypted_secrets where name = 'hydrate_vapid_private_jwk' limit 1)
  );
$$;

-- Service-role only: store freshly generated VAPID keys (first run only; never overwrites).
create or replace function public.hydrate_set_vapid(p_public text, p_private_jwk text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from vault.secrets where name = 'hydrate_vapid_public') then
    return false;
  end if;
  perform vault.create_secret(p_public, 'hydrate_vapid_public', 'Hydrate VAPID public key');
  perform vault.create_secret(p_private_jwk, 'hydrate_vapid_private_jwk', 'Hydrate VAPID private key (JWK)');
  return true;
end;
$$;

-- -----------------------------------------------------------------------------
-- Atomically claim users whose reminder is due right now (same rules as the
-- client scheduler in src/reminders/schedule.ts):
--   anchor = latest of (resumed, last reminder, last drink)
--   next   = snooze_until if snoozed after the anchor, else anchor + interval
--   due    = now >= next AND it is currently waking hours in the user's timezone
-- Rows are locked with SKIP LOCKED and stamped, so overlapping runs never double-send.
-- -----------------------------------------------------------------------------
create or replace function public.claim_due_push_reminders()
returns table (o_user_id uuid, o_total_ml integer, o_goal_ml integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  r          record;
  v_tz       text;
  v_goal     integer;
  v_last_log timestamptz;
  v_anchor   timestamptz;
  v_next     timestamptz;
  v_lt       time;
begin
  for r in
    select rs.* from public.reminder_settings rs
     where rs.notifications_enabled
       and exists (select 1 from public.push_subscriptions ps where ps.user_id = rs.user_id)
     for update of rs skip locked
  loop
    select p.timezone, p.daily_goal_ml into v_tz, v_goal from public.profiles p where p.id = r.user_id;
    v_tz := coalesce(v_tz, 'UTC');
    select max(l.logged_at) into v_last_log from public.hydration_logs l where l.user_id = r.user_id;

    v_anchor := greatest(coalesce(r.resumed_at, r.created_at),
                         coalesce(r.last_reminded_at, '-infinity'),
                         coalesce(v_last_log, '-infinity'));
    if r.snooze_until is not null and r.snoozed_at is not null and r.snoozed_at >= v_anchor then
      v_next := r.snooze_until;
    else
      v_next := v_anchor + make_interval(mins => r.interval_minutes);
    end if;
    continue when now() < v_next;

    v_lt := (now() at time zone v_tz)::time;
    continue when not (case when r.wake_time < r.sleep_time
                            then v_lt >= r.wake_time and v_lt < r.sleep_time
                            else v_lt >= r.wake_time or v_lt < r.sleep_time end);

    update public.reminder_settings
       set last_reminded_at = now(), snooze_until = null, snoozed_at = null
     where id = r.id;

    o_user_id := r.user_id;
    o_goal_ml := coalesce(v_goal, 2500);
    select coalesce(sum(l.amount_ml), 0)::integer into o_total_ml
      from public.hydration_logs l
     where l.user_id = r.user_id
       and l.logged_at > now() - interval '2 days'
       and (l.logged_at at time zone l.timezone)::date = (now() at time zone v_tz)::date;
    return next;
  end loop;
end;
$$;

revoke all on function public.hydrate_push_config()                 from public, anon, authenticated;
revoke all on function public.hydrate_set_vapid(text, text)          from public, anon, authenticated;
revoke all on function public.claim_due_push_reminders()             from public, anon, authenticated;
grant execute on function public.hydrate_push_config()               to service_role;
grant execute on function public.hydrate_set_vapid(text, text)        to service_role;
grant execute on function public.claim_due_push_reminders()           to service_role;
