-- Shared secret between the Next.js server and the new `priority-pull-now`
-- edge function (which calls Priority's OData API directly using
-- priority_user/priority_password/priority_url — Edge Function project
-- secrets set via the Supabase dashboard, not Vault). The edge function has
-- verify_jwt=false (like the other sync-* functions) and instead checks an
-- `x-priority-secret` header against this value, so only our own Next.js
-- server (which fetches it via the RPC below, granted to `authenticated`
-- only) can trigger a real Priority pull + SMS-queue insert.
select vault.create_secret(gen_random_uuid()::text, 'survey-priority-pull-secret', 'Shared secret: Next.js server -> priority-pull-now edge function');

create or replace function public.get_priority_pull_secret()
returns text
language sql
security definer
set search_path = public, vault
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'survey-priority-pull-secret'
$$;

revoke all on function public.get_priority_pull_secret() from public, anon;
grant execute on function public.get_priority_pull_secret() to authenticated, service_role;
