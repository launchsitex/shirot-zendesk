-- Schedules the daily "יעדים לנציגים" email.
--
-- NOT APPLIED YET — applying this is what starts sending mail to the recipient
-- list. Apply it once the targets and recipients are configured and a forced
-- test send has been eyeballed.
--
-- Twice a day on purpose: pg_cron schedules in UTC and has no timezone
-- support, while 15:30 in Jerusalem is 12:30 UTC in summer (IDT) and 13:30 UTC
-- in winter (IST). The function itself decides whether to send:
--   * before the configured local time  -> skips ("before_cutoff")
--   * already sent today                -> skips ("already_sent_today")
-- So in summer the 12:30 run sends and the 13:30 run no-ops; in winter the
-- 12:30 run is still 14:30 locally and skips, and the 13:30 run sends. No DST
-- bookkeeping and no duplicate mail on the changeover days.

select cron.unschedule('agent-targets-report-daily')
where exists (
  select 1 from cron.job where jobname = 'agent-targets-report-daily'
);

select cron.schedule(
  'agent-targets-report-daily',
  '30 12,13 * * *',
  $$
    select net.http_post(
      url := (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'project_url'
      ) || '/functions/v1/agent-targets-report',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-sync-secret', (
          select decrypted_secret from vault.decrypted_secrets
          where name = 'sync_function_secret'
        )
      ),
      body := '{}'::jsonb
    );
  $$
);
