create table if not exists private.aircall_api_settings (
  singleton boolean primary key default true check (singleton),
  api_id_secret_id uuid not null references vault.secrets(id),
  api_token_secret_id uuid not null references vault.secrets(id),
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create or replace function private.save_aircall_api_credentials_authenticated(
  p_api_id text,
  p_api_token text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_api_id_secret uuid;
  previous_api_token_secret uuid;
  new_api_id_secret uuid;
  new_api_token_secret uuid;
begin
  if not exists (
    select 1
    from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  ) then
    raise exception 'admin role required';
  end if;
  if length(trim(p_api_id)) < 3 or length(trim(p_api_token)) < 8 then
    raise exception 'invalid Aircall API credentials';
  end if;

  select api_id_secret_id, api_token_secret_id
  into previous_api_id_secret, previous_api_token_secret
  from private.aircall_api_settings
  where singleton = true;

  select vault.create_secret(
    trim(p_api_id),
    'aircall-api-id-' || gen_random_uuid()::text,
    'Aircall API ID'
  ) into new_api_id_secret;
  select vault.create_secret(
    trim(p_api_token),
    'aircall-api-token-' || gen_random_uuid()::text,
    'Aircall API token'
  ) into new_api_token_secret;

  insert into private.aircall_api_settings (
    singleton,
    api_id_secret_id,
    api_token_secret_id,
    enabled,
    updated_at
  )
  values (
    true,
    new_api_id_secret,
    new_api_token_secret,
    true,
    now()
  )
  on conflict (singleton) do update set
    api_id_secret_id = excluded.api_id_secret_id,
    api_token_secret_id = excluded.api_token_secret_id,
    enabled = true,
    updated_at = now();

  if previous_api_id_secret is not null then
    delete from vault.secrets where id = previous_api_id_secret;
  end if;
  if previous_api_token_secret is not null then
    delete from vault.secrets where id = previous_api_token_secret;
  end if;

  perform net.http_post(
    url := (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'project_url'
    ) || '/functions/v1/sync-aircall-users',
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
end;
$$;

create or replace function public.save_aircall_api_credentials_authenticated(
  p_api_id text,
  p_api_token text
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.save_aircall_api_credentials_authenticated(p_api_id, p_api_token);
$$;

create or replace function private.aircall_api_configured_authenticated()
returns boolean
language sql
security definer
set search_path = ''
as $$
  select
    exists (
      select 1 from public.profiles
      where id = (select auth.uid()) and role = 'admin'
    )
    and exists (
      select 1 from private.aircall_api_settings
      where singleton = true and enabled = true
    );
$$;

create or replace function public.aircall_api_configured_authenticated()
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select private.aircall_api_configured_authenticated();
$$;

create or replace function private.get_aircall_api_credentials()
returns table (api_id text, api_token text)
language sql
security definer
set search_path = ''
as $$
  select api_id.decrypted_secret, api_token.decrypted_secret
  from private.aircall_api_settings as settings
  join vault.decrypted_secrets as api_id
    on api_id.id = settings.api_id_secret_id
  join vault.decrypted_secrets as api_token
    on api_token.id = settings.api_token_secret_id
  where settings.singleton = true and settings.enabled = true;
$$;

create or replace function public.get_aircall_api_credentials()
returns table (api_id text, api_token text)
language sql
security invoker
set search_path = ''
as $$
  select * from private.get_aircall_api_credentials();
$$;

revoke all on function private.save_aircall_api_credentials_authenticated(text, text)
  from public, anon;
grant execute on function private.save_aircall_api_credentials_authenticated(text, text)
  to authenticated;
revoke all on function public.save_aircall_api_credentials_authenticated(text, text)
  from public, anon;
grant execute on function public.save_aircall_api_credentials_authenticated(text, text)
  to authenticated;

revoke all on function private.aircall_api_configured_authenticated()
  from public, anon;
grant execute on function private.aircall_api_configured_authenticated()
  to authenticated;
revoke all on function public.aircall_api_configured_authenticated()
  from public, anon;
grant execute on function public.aircall_api_configured_authenticated()
  to authenticated;

revoke all on function public.get_aircall_api_credentials()
  from public, anon, authenticated;
grant execute on function public.get_aircall_api_credentials()
  to service_role;
revoke all on function private.get_aircall_api_credentials()
  from public, anon, authenticated;
grant execute on function private.get_aircall_api_credentials()
  to service_role;

do $$
begin
  if exists (
    select 1 from cron.job where jobname = 'aircall-users-every-minute'
  ) then
    perform cron.unschedule('aircall-users-every-minute');
  end if;
  perform cron.schedule(
    'aircall-users-every-minute',
    '* * * * *',
    $cron$
      select net.http_post(
        url := (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'project_url'
        ) || '/functions/v1/sync-aircall-users',
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
        select 1 from private.aircall_api_settings
        where singleton = true and enabled = true
      );
    $cron$
  );
end;
$$;
