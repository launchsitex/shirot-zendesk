do $$
begin
  if not exists (
    select 1 from vault.secrets where name = 'aircall-webhook-key'
  ) then
    perform vault.create_secret(
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      'aircall-webhook-key',
      'Secret URL key for Aircall webhook ingestion'
    );
  end if;
end;
$$;

create table if not exists public.aircall_webhook_events (
  id bigint generated always as identity primary key,
  delivery_hash text not null unique,
  event_type text not null,
  aircall_token text,
  payload jsonb not null,
  processed boolean not null default false,
  error_message text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists aircall_webhook_events_received_idx
  on public.aircall_webhook_events (received_at desc);

alter table public.aircall_webhook_events enable row level security;

drop policy if exists "admins read aircall webhook events"
  on public.aircall_webhook_events;
create policy "admins read aircall webhook events"
  on public.aircall_webhook_events
  for select to authenticated
  using (public.is_admin());

create or replace function public.verify_aircall_webhook_key(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from vault.decrypted_secrets
    where name = 'aircall-webhook-key'
      and decrypted_secret = p_key
  );
$$;

revoke all on function public.verify_aircall_webhook_key(text)
  from public, anon, authenticated;
grant execute on function public.verify_aircall_webhook_key(text)
  to service_role;

create or replace function public.get_aircall_webhook_key_authenticated()
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

revoke all on function public.get_aircall_webhook_key_authenticated()
  from public, anon;
grant execute on function public.get_aircall_webhook_key_authenticated()
  to authenticated;

alter publication supabase_realtime add table public.aircall_webhook_events;
