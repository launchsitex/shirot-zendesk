select cron.unschedule('zendesk-live-every-15-seconds');
select cron.unschedule('zendesk-history-every-minute');

delete from public.sync_runs
where status = 'failed'
  and error_message = 'Zendesk integration is not configured';

select cron.schedule(
  'zendesk-live-every-15-seconds',
  '15 seconds',
  $$
  select net.http_post(
    url := (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'project_url'
    ) || '/functions/v1/sync-live',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'sync_function_secret'
      )
    ),
    body := '{}'::jsonb
  )
  where exists (
    select 1
    from public.integration_settings
    where provider = 'zendesk_talk' and enabled = true
  );
  $$
);

select cron.schedule(
  'zendesk-history-every-minute',
  '* * * * *',
  $$
  select net.http_post(
    url := (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'project_url'
    ) || '/functions/v1/sync-history',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'sync_function_secret'
      )
    ),
    body := '{}'::jsonb
  )
  where exists (
    select 1
    from public.integration_settings
    where provider = 'zendesk_talk' and enabled = true
  );
  $$
);
