-- The Zendesk ticket sync ran once a minute, so an agent self-assigning a
-- ticket out of the queue could take up to ~60s just to reach our database
-- (plus the dashboard's own 30s poll on top). net.http_post is async — it
-- queues the request and returns immediately, it does not block this job
-- for the request's duration — so firing twice a minute, 30s apart via
-- pg_sleep, is safe: the job's own runtime is ~30s, well clear of the next
-- minute's invocation. sync-zendesk-tickets is idempotent (cursor-based,
-- upsert-on-conflict), so an occasional overlap is harmless.
-- Account owner, 2026-09-22.

select cron.alter_job(
  job_id := (select jobid from cron.job where jobname = 'zendesk-tickets-sync'),
  command := $$
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
      timeout_milliseconds := 50000
    );
    select pg_sleep(30);
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
      timeout_milliseconds := 50000
    );
  $$
);
