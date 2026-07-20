create or replace function private.save_zendesk_integration_authenticated(
  p_subdomain text,
  p_email text,
  p_api_token text,
  p_has_talk boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
begin
  if caller_id is null then
    raise exception 'authentication required';
  end if;
  perform private.save_zendesk_integration(
    p_subdomain,
    p_email,
    p_api_token,
    p_has_talk,
    caller_id
  );
end;
$$;

revoke all on function private.save_zendesk_integration_authenticated(text, text, text, boolean)
  from public, anon;
grant execute on function private.save_zendesk_integration_authenticated(text, text, text, boolean)
  to authenticated;

create or replace function public.save_zendesk_integration_authenticated(
  p_subdomain text,
  p_email text,
  p_api_token text,
  p_has_talk boolean
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.save_zendesk_integration_authenticated(
    p_subdomain,
    p_email,
    p_api_token,
    p_has_talk
  );
$$;

revoke all on function public.save_zendesk_integration_authenticated(text, text, text, boolean)
  from public, anon;
grant execute on function public.save_zendesk_integration_authenticated(text, text, text, boolean)
  to authenticated;

create or replace function private.replace_department_mappings_authenticated(
  p_group_mappings jsonb,
  p_line_mappings jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  ) then
    raise exception 'admin role required';
  end if;
  perform private.replace_department_mappings(
    p_group_mappings,
    p_line_mappings
  );
end;
$$;

revoke all on function private.replace_department_mappings_authenticated(jsonb, jsonb)
  from public, anon;
grant execute on function private.replace_department_mappings_authenticated(jsonb, jsonb)
  to authenticated;

create or replace function public.replace_department_mappings_authenticated(
  p_group_mappings jsonb,
  p_line_mappings jsonb
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.replace_department_mappings_authenticated(
    p_group_mappings,
    p_line_mappings
  );
$$;

revoke all on function public.replace_department_mappings_authenticated(jsonb, jsonb)
  from public, anon;
grant execute on function public.replace_department_mappings_authenticated(jsonb, jsonb)
  to authenticated;
