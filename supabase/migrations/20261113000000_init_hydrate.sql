-- =============================================================================
-- HYDRATE — initial schema
-- Tables: profiles, hydration_logs, reminder_settings, daily_summaries
-- Every table has Row Level Security: users can only see/modify their own rows.
-- =============================================================================

-- gen_random_uuid() is built into Postgres 13+; no extension needed.

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------
create or replace function public.is_valid_timezone(tz text)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
begin
  if tz is null or char_length(tz) = 0 then
    return false;
  end if;
  perform now() at time zone tz;
  return true;
exception when others then
  return false;
end;
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- profiles
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  full_name     text check (full_name is null or char_length(full_name) <= 120),
  daily_goal_ml integer not null default 2500
                check (daily_goal_ml between 500 and 10000),
  timezone      text not null default 'UTC'
                check (char_length(timezone) between 1 and 64),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- hydration_logs
-- -----------------------------------------------------------------------------
create table if not exists public.hydration_logs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  amount_ml  integer not null check (amount_ml between 1 and 5000),
  logged_at  timestamptz not null default now(),
  timezone   text not null default 'UTC' check (char_length(timezone) between 1 and 64),
  created_at timestamptz not null default now()
);

create index if not exists hydration_logs_user_logged_at_idx
  on public.hydration_logs (user_id, logged_at desc);

-- -----------------------------------------------------------------------------
-- reminder_settings
-- -----------------------------------------------------------------------------
create table if not exists public.reminder_settings (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null unique default auth.uid() references auth.users (id) on delete cascade,
  interval_minutes      integer not null default 60 check (interval_minutes in (30, 45, 60, 90)),
  wake_time             time not null default '07:00',
  sleep_time            time not null default '22:30',
  notifications_enabled boolean not null default false,
  sound_enabled         boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint reminder_settings_wake_ne_sleep check (wake_time <> sleep_time)
);

create trigger reminder_settings_set_updated_at
  before update on public.reminder_settings
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- daily_summaries (maintained automatically by triggers on hydration_logs)
-- -----------------------------------------------------------------------------
create table if not exists public.daily_summaries (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  summary_date   date not null,
  total_ml       integer not null default 0 check (total_ml >= 0),
  goal_ml        integer not null check (goal_ml > 0),
  goal_completed boolean not null default false,
  entry_count    integer not null default 0 check (entry_count >= 0),
  updated_at     timestamptz not null default now(),
  constraint daily_summaries_user_date_key unique (user_id, summary_date)
);

create index if not exists daily_summaries_user_date_idx
  on public.daily_summaries (user_id, summary_date desc);

-- Recompute one user's summary for one local calendar date.
create or replace function public.refresh_daily_summary(p_user_id uuid, p_date date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total    integer;
  v_count    integer;
  v_goal     integer;
  v_tz       text;
  v_existing integer;
begin
  -- A ±1 day UTC window lets the (user_id, logged_at) index narrow the scan
  -- before the exact local-date filter is applied.
  select coalesce(sum(amount_ml), 0), count(*)
    into v_total, v_count
    from public.hydration_logs
   where user_id = p_user_id
     and logged_at >= (p_date - 1)::timestamp at time zone 'UTC'
     and logged_at <  (p_date + 2)::timestamp at time zone 'UTC'
     and (logged_at at time zone timezone)::date = p_date;

  select daily_goal_ml, timezone into v_goal, v_tz
    from public.profiles where id = p_user_id;
  v_goal := coalesce(v_goal, 2500);
  v_tz   := coalesce(v_tz, 'UTC');

  if v_count = 0 then
    delete from public.daily_summaries
     where user_id = p_user_id and summary_date = p_date;
    return;
  end if;

  -- Past days keep the goal that was in force on that day; today/future use the current goal.
  if p_date < (now() at time zone v_tz)::date then
    select goal_ml into v_existing
      from public.daily_summaries
     where user_id = p_user_id and summary_date = p_date;
    v_goal := coalesce(v_existing, v_goal);
  end if;

  insert into public.daily_summaries
    (user_id, summary_date, total_ml, goal_ml, goal_completed, entry_count, updated_at)
  values
    (p_user_id, p_date, v_total, v_goal, v_total >= v_goal, v_count, now())
  on conflict (user_id, summary_date) do update
    set total_ml       = excluded.total_ml,
        goal_ml        = excluded.goal_ml,
        goal_completed = excluded.goal_completed,
        entry_count    = excluded.entry_count,
        updated_at     = now();
end;
$$;

revoke all on function public.refresh_daily_summary(uuid, date) from public, anon, authenticated;

create or replace function public.hydration_logs_after_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.refresh_daily_summary(new.user_id, (new.logged_at at time zone new.timezone)::date);
  end if;
  if tg_op in ('DELETE', 'UPDATE') then
    perform public.refresh_daily_summary(old.user_id, (old.logged_at at time zone old.timezone)::date);
  end if;
  return null;
end;
$$;

create trigger hydration_logs_summary_sync
  after insert or update or delete on public.hydration_logs
  for each row execute function public.hydration_logs_after_change();

-- Validate log timezone (falls back to UTC instead of failing the insert).
create or replace function public.hydration_logs_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_valid_timezone(new.timezone) then
    new.timezone := 'UTC';
  end if;
  return new;
end;
$$;

create trigger hydration_logs_validate_tz
  before insert or update on public.hydration_logs
  for each row execute function public.hydration_logs_before_write();

-- When the daily goal changes, refresh today's summary so completion is accurate.
create or replace function public.profiles_after_goal_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.daily_goal_ml is distinct from old.daily_goal_ml then
    update public.daily_summaries
       set goal_ml = new.daily_goal_ml,
           goal_completed = total_ml >= new.daily_goal_ml,
           updated_at = now()
     where user_id = new.id
       and summary_date = (now() at time zone new.timezone)::date;
  end if;
  return null;
end;
$$;

create trigger profiles_goal_change
  after update of daily_goal_ml on public.profiles
  for each row execute function public.profiles_after_goal_change();

-- -----------------------------------------------------------------------------
-- New user bootstrap: create profile + default reminder settings
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tz text := coalesce(new.raw_user_meta_data ->> 'timezone', 'UTC');
begin
  if not public.is_valid_timezone(v_tz) then
    v_tz := 'UTC';
  end if;

  insert into public.profiles (id, full_name, timezone)
  values (new.id, nullif(left(trim(new.raw_user_meta_data ->> 'full_name'), 120), ''), v_tz)
  on conflict (id) do nothing;

  insert into public.reminder_settings (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.profiles          enable row level security;
alter table public.hydration_logs    enable row level security;
alter table public.reminder_settings enable row level security;
alter table public.daily_summaries   enable row level security;

-- profiles
create policy "profiles_select_own" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated with check ((select auth.uid()) = id);
create policy "profiles_update_own" on public.profiles
  for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

-- hydration_logs
create policy "logs_select_own" on public.hydration_logs
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "logs_insert_own" on public.hydration_logs
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "logs_update_own" on public.hydration_logs
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "logs_delete_own" on public.hydration_logs
  for delete to authenticated using ((select auth.uid()) = user_id);

-- reminder_settings
create policy "reminders_select_own" on public.reminder_settings
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "reminders_insert_own" on public.reminder_settings
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "reminders_update_own" on public.reminder_settings
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- daily_summaries: read-only for clients (written by security-definer triggers)
create policy "summaries_select_own" on public.daily_summaries
  for select to authenticated using ((select auth.uid()) = user_id);

-- Table privileges (anon gets nothing)
revoke all on public.profiles, public.hydration_logs, public.reminder_settings, public.daily_summaries from anon;
grant select, insert, update          on public.profiles          to authenticated;
grant select, insert, update, delete  on public.hydration_logs    to authenticated;
grant select, insert, update          on public.reminder_settings to authenticated;
grant select                          on public.daily_summaries   to authenticated;
