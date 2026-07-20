alter table public.calls
  add column if not exists recordings_checked_at timestamptz;

create index if not exists calls_recordings_checked_at_idx
  on public.calls (recordings_checked_at, started_at desc);

create unique index if not exists department_groups_group_id_key
  on public.department_groups (group_id);
create unique index if not exists department_lines_line_id_key
  on public.department_lines (line_id);

create or replace function private.save_zendesk_integration(
  p_subdomain text,
  p_email text,
  p_api_token text,
  p_has_talk boolean,
  p_created_by uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_secret_id uuid;
  previous_secret_id uuid;
begin
  if p_api_token is null or length(p_api_token) < 10 then
    raise exception 'invalid API token';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = p_created_by and role = 'admin'
  ) then
    raise exception 'admin role required';
  end if;

  select secret_id into previous_secret_id
  from public.integration_settings
  where provider = 'zendesk_talk';

  select vault.create_secret(
    p_api_token,
    'zendesk-talk-token-' || gen_random_uuid()::text,
    'Zendesk Talk API token'
  ) into new_secret_id;

  insert into public.integration_settings (
    provider, subdomain, email, secret_id, enabled, has_talk,
    last_tested_at, last_test_status, created_by
  )
  values (
    'zendesk_talk', lower(p_subdomain), lower(p_email), new_secret_id, true,
    p_has_talk, now(), case when p_has_talk then 'ok' else 'support_only' end,
    p_created_by
  )
  on conflict (provider) do update set
    subdomain = excluded.subdomain,
    email = excluded.email,
    secret_id = excluded.secret_id,
    enabled = true,
    has_talk = excluded.has_talk,
    last_tested_at = excluded.last_tested_at,
    last_test_status = excluded.last_test_status,
    updated_at = now();

  if previous_secret_id is not null then
    delete from vault.secrets where id = previous_secret_id;
  end if;
end;
$$;

revoke all on function private.save_zendesk_integration(text, text, text, boolean, uuid)
  from public, anon, authenticated;
grant execute on function private.save_zendesk_integration(text, text, text, boolean, uuid)
  to service_role;

create or replace function public.save_zendesk_integration_service(
  p_subdomain text,
  p_email text,
  p_api_token text,
  p_has_talk boolean,
  p_created_by uuid
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.save_zendesk_integration(
    p_subdomain, p_email, p_api_token, p_has_talk, p_created_by
  );
$$;

revoke all on function public.save_zendesk_integration_service(text, text, text, boolean, uuid)
  from public, anon, authenticated;
grant execute on function public.save_zendesk_integration_service(text, text, text, boolean, uuid)
  to service_role;

create or replace function private.replace_department_mappings(
  p_group_mappings jsonb,
  p_line_mappings jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.department_groups;
  insert into public.department_groups (group_id, department_id)
  select item ->> 'groupId', item ->> 'departmentId'
  from jsonb_array_elements(coalesce(p_group_mappings, '[]'::jsonb)) item;

  delete from public.department_lines;
  insert into public.department_lines (line_id, department_id)
  select item ->> 'lineId', item ->> 'departmentId'
  from jsonb_array_elements(coalesce(p_line_mappings, '[]'::jsonb)) item;

  perform public.refresh_call_departments();
end;
$$;

revoke all on function private.replace_department_mappings(jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function private.replace_department_mappings(jsonb, jsonb)
  to service_role;

create or replace function public.replace_department_mappings(
  p_group_mappings jsonb,
  p_line_mappings jsonb
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.replace_department_mappings(p_group_mappings, p_line_mappings);
$$;

revoke all on function public.replace_department_mappings(jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.replace_department_mappings(jsonb, jsonb)
  to service_role;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  initial_role public.app_role;
begin
  lock table public.profiles in share row exclusive mode;
  select case
    when exists (select 1 from public.profiles)
      then 'viewer'::public.app_role
    else 'admin'::public.app_role
  end into initial_role;
  insert into public.profiles (id, display_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', new.email),
    initial_role
  );
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'dashboard-retention') then
    perform cron.unschedule('dashboard-retention');
  end if;
  perform cron.schedule(
    'dashboard-retention',
    '17 2 * * *',
    $retention$
      delete from public.queue_snapshots
      where captured_at < now() - interval '90 days';
      delete from public.sync_runs
      where started_at < now() - interval '30 days';
    $retention$
  );
end;
$$;
