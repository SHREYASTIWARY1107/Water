-- Run the push scheduler every minute.
-- NOTE: replace the project ref in the URL if you deploy to a different Supabase project.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

select cron.unschedule('hydrate-send-reminders')
 where exists (select 1 from cron.job where jobname = 'hydrate-send-reminders');

select cron.schedule(
  'hydrate-send-reminders',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://qgjqujkfzkwevcpxyfzi.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'hydrate_cron_secret' limit 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
  $$
);
