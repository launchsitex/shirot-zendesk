create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

do $$
begin
  if not exists (
    select 1 from vault.secrets where name = 'project_url'
  ) then
    perform vault.create_secret(
      'https://whshmunahkugkmgxkvvw.supabase.co',
      'project_url',
      'Supabase project URL used by Zendesk sync schedules'
    );
  end if;

  if not exists (
    select 1 from vault.secrets where name = 'sync_function_secret'
  ) then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'sync_function_secret',
      'Authorization secret for Zendesk sync functions'
    );
  end if;
end;
$$;

create or replace function public.get_sync_secret()
returns text
language sql
security definer
set search_path = ''
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = 'sync_function_secret'
  limit 1;
$$;

revoke all on function public.get_sync_secret() from public, anon, authenticated;
grant execute on function public.get_sync_secret() to service_role;

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
  );
  $$
);
