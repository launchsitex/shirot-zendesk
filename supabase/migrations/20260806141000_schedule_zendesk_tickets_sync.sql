-- Applied to the live project on 2026-08-06.
--
-- Keeps "מעקב פניות" current. Every two minutes is well inside Zendesk's
-- incremental-export limit of ten requests a minute: a steady-state run fetches
-- a single page, and the cursor in zendesk_sync_state means a run that is
-- skipped or fails simply resumes rather than losing tickets.
--
-- Unlike the daily report there is no time-of-day guard here, so no timezone
-- handling is needed — this runs around the clock.

select cron.unschedule('zendesk-tickets-sync')
where exists (select 1 from cron.job where jobname = 'zendesk-tickets-sync');

select cron.schedule(
  'zendesk-tickets-sync',
  '*/2 * * * *',
  $$
    select net.http_post(
      url := (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'project_url'
      ) || '/functions/v1/sync-zendesk-tickets',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-sync-secret', (
          select decrypted_secret from vault.decrypted_secrets
          where name = 'sync_function_secret'
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $$
);
