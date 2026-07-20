create or replace function private.get_aircall_webhook_key_authenticated()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result text;
begin
  if not exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  ) then
    raise exception 'admin role required';
  end if;
  select decrypted_secret into result
  from vault.decrypted_secrets
  where name = 'aircall-webhook-key';
  return result;
end;
$$;

revoke all on function private.get_aircall_webhook_key_authenticated()
  from public, anon;
grant execute on function private.get_aircall_webhook_key_authenticated()
  to authenticated;

create or replace function public.get_aircall_webhook_key_authenticated()
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select private.get_aircall_webhook_key_authenticated();
$$;

revoke all on function public.get_aircall_webhook_key_authenticated()
  from public, anon;
grant execute on function public.get_aircall_webhook_key_authenticated()
  to authenticated;
