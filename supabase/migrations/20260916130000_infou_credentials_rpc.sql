-- Lets the Next.js server (running as the logged-in admin's "authenticated"
-- session, per this project's existing RLS convention of "true" + app-level
-- page gating) read the InfoU SMS API credentials without ever exposing them
-- to the client or committing them to the repo. Values live in Supabase
-- Vault (see vault.secrets: infou-api-user, infou-api-token).
create or replace function public.get_infou_credentials()
returns table (username text, token text)
language sql
security definer
set search_path = public, vault
as $$
  select
    (select decrypted_secret from vault.decrypted_secrets where name = 'infou-api-user'),
    (select decrypted_secret from vault.decrypted_secrets where name = 'infou-api-token')
$$;

revoke all on function public.get_infou_credentials() from public, anon;
grant execute on function public.get_infou_credentials() to authenticated;
