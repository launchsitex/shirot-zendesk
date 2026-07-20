create extension if not exists pgcrypto with schema extensions;
create extension if not exists supabase_vault with schema vault;

create type public.app_role as enum ('admin', 'manager', 'viewer');
create type public.call_direction as enum ('inbound', 'outbound');
create type public.call_status as enum ('answered', 'missed', 'in_progress');
create type public.agent_state as enum ('available', 'ringing', 'on_call', 'wrap_up', 'unavailable');
create type public.sync_status as enum ('running', 'success', 'failed');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  role public.app_role not null default 'viewer',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.integration_settings (
  id uuid primary key default gen_random_uuid(),
  provider text not null unique check (provider in ('zendesk_talk')),
  subdomain text not null,
  email text not null,
  secret_id uuid not null,
  enabled boolean not null default true,
  has_talk boolean not null default false,
  last_tested_at timestamptz,
  last_test_status text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.departments (
  id text primary key,
  name text not null,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.departments (id, name, sort_order)
values ('customer-service', 'שירות לקוחות', 10), ('deliveries', 'אספקות', 20);

create table public.zendesk_groups (
  id text primary key,
  name text not null,
  active boolean not null default true,
  raw jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now()
);

create table public.department_groups (
  department_id text not null references public.departments(id) on delete cascade,
  group_id text not null references public.zendesk_groups(id) on delete cascade,
  primary key (department_id, group_id)
);

create table public.talk_lines (
  id text primary key,
  name text not null,
  number text,
  active boolean not null default true,
  raw jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now()
);

create table public.department_lines (
  department_id text not null references public.departments(id) on delete cascade,
  line_id text not null references public.talk_lines(id) on delete cascade,
  primary key (department_id, line_id)
);

create table public.agents (
  id text primary key,
  name text not null,
  email text,
  avatar_url text,
  department_id text references public.departments(id) on delete set null,
  active boolean not null default true,
  raw jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now()
);

create table public.zendesk_customers (
  id text primary key,
  name text,
  phone text,
  raw jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now()
);

create table public.agent_group_memberships (
  agent_id text not null references public.agents(id) on delete cascade,
  group_id text not null references public.zendesk_groups(id) on delete cascade,
  primary key (agent_id, group_id)
);

create table public.calls (
  id text primary key,
  direction public.call_direction not null,
  status public.call_status not null,
  completion_status text,
  agent_id text references public.agents(id) on delete set null,
  customer_id text references public.zendesk_customers(id) on delete set null,
  department_id text references public.departments(id) on delete set null,
  line_id text references public.talk_lines(id) on delete set null,
  customer_number text not null default '',
  started_at timestamptz not null,
  ended_at timestamptz,
  duration_seconds integer not null default 0 check (duration_seconds >= 0),
  talk_time_seconds integer not null default 0 check (talk_time_seconds >= 0),
  wait_time_seconds integer not null default 0 check (wait_time_seconds >= 0),
  raw jsonb not null default '{}'::jsonb,
  source_updated_at timestamptz,
  synced_at timestamptz not null default now()
);

create table public.call_legs (
  id text primary key,
  call_id text not null references public.calls(id) on delete cascade,
  agent_id text references public.agents(id) on delete set null,
  leg_type text,
  completion_status text,
  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer not null default 0,
  talk_time_seconds integer not null default 0,
  wrap_up_seconds integer not null default 0,
  raw jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now()
);

create table public.agent_live_status (
  agent_id text primary key references public.agents(id) on delete cascade,
  state public.agent_state not null default 'unavailable',
  zendesk_agent_state text,
  zendesk_call_status text,
  state_since timestamptz not null default now(),
  current_call_started_at timestamptz,
  raw jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.queue_snapshots (
  id bigint generated always as identity primary key,
  department_id text references public.departments(id) on delete set null,
  calls_waiting integer not null default 0,
  callbacks_waiting integer not null default 0,
  agents_online integer not null default 0,
  average_wait_seconds integer not null default 0,
  longest_wait_seconds integer not null default 0,
  captured_at timestamptz not null default now(),
  raw jsonb not null default '{}'::jsonb
);

create table public.sync_state (
  stream text primary key,
  cursor text,
  start_time bigint,
  updated_at timestamptz not null default now()
);

create table public.sync_runs (
  id bigint generated always as identity primary key,
  stream text not null,
  status public.sync_status not null default 'running',
  records_processed integer not null default 0,
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index calls_started_at_idx on public.calls (started_at desc);
create index calls_department_started_idx on public.calls (department_id, started_at desc);
create index calls_agent_started_idx on public.calls (agent_id, started_at desc);
create index calls_customer_idx on public.calls (customer_id);
create index calls_direction_status_idx on public.calls (direction, status);
create index call_legs_call_idx on public.call_legs (call_id);
create index queue_snapshots_captured_idx on public.queue_snapshots (captured_at desc);
create index sync_runs_started_idx on public.sync_runs (started_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger integrations_set_updated_at before update on public.integration_settings
for each row execute function public.set_updated_at();
create trigger departments_set_updated_at before update on public.departments
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  initial_role public.app_role;
begin
  select case when exists (select 1 from public.profiles) then 'viewer'::public.app_role else 'admin'::public.app_role end
  into initial_role;
  insert into public.profiles (id, display_name, role)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', new.email), initial_role);
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;

create or replace function public.save_zendesk_integration(
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
  new_secret_id uuid;
  previous_secret_id uuid;
begin
  if not public.is_admin() then
    raise exception 'admin role required';
  end if;
  if p_api_token is null or length(p_api_token) < 10 then
    raise exception 'invalid API token';
  end if;

  select secret_id into previous_secret_id
  from public.integration_settings
  where provider = 'zendesk_talk';

  if previous_secret_id is not null then
    delete from vault.secrets where id = previous_secret_id;
  end if;

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
    (select auth.uid())
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
end;
$$;

create or replace function public.get_zendesk_credentials()
returns table (subdomain text, email text, api_token text)
language sql
security definer
set search_path = ''
as $$
  select settings.subdomain, settings.email, secrets.decrypted_secret
  from public.integration_settings settings
  join vault.decrypted_secrets secrets on secrets.id = settings.secret_id
  where settings.provider = 'zendesk_talk' and settings.enabled = true;
$$;

create or replace function public.refresh_call_departments()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.calls as call
  set department_id = coalesce(
    (
      select mapping.department_id
      from public.department_groups mapping
      where mapping.group_id = call.raw ->> 'call_group_id'
      limit 1
    ),
    (
      select mapping.department_id
      from public.department_lines mapping
      where mapping.line_id = call.line_id
      limit 1
    ),
    (
      select agent.department_id
      from public.agents agent
      where agent.id = call.agent_id
    )
  );
$$;

revoke all on function public.save_zendesk_integration(text, text, text, boolean) from public, anon;
grant execute on function public.save_zendesk_integration(text, text, text, boolean) to authenticated;
revoke all on function public.get_zendesk_credentials() from public, anon, authenticated;
grant execute on function public.get_zendesk_credentials() to service_role;
revoke all on function public.refresh_call_departments() from public, anon, authenticated;
grant execute on function public.refresh_call_departments() to service_role;

alter table public.profiles enable row level security;
alter table public.integration_settings enable row level security;
alter table public.departments enable row level security;
alter table public.zendesk_groups enable row level security;
alter table public.department_groups enable row level security;
alter table public.talk_lines enable row level security;
alter table public.department_lines enable row level security;
alter table public.agents enable row level security;
alter table public.zendesk_customers enable row level security;
alter table public.agent_group_memberships enable row level security;
alter table public.calls enable row level security;
alter table public.call_legs enable row level security;
alter table public.agent_live_status enable row level security;
alter table public.queue_snapshots enable row level security;
alter table public.sync_state enable row level security;
alter table public.sync_runs enable row level security;

create policy "users read own profile" on public.profiles
for select to authenticated using (id = (select auth.uid()) or public.is_admin());
create policy "admins update profiles" on public.profiles
for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "admins read integration metadata" on public.integration_settings
for select to authenticated using (public.is_admin());
create policy "admins manage departments" on public.departments
for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "authenticated read departments" on public.departments
for select to authenticated using (true);

create policy "authenticated read groups" on public.zendesk_groups
for select to authenticated using (true);
create policy "authenticated read department groups" on public.department_groups
for select to authenticated using (true);
create policy "admins manage department groups" on public.department_groups
for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "authenticated read talk lines" on public.talk_lines
for select to authenticated using (true);
create policy "authenticated read department lines" on public.department_lines
for select to authenticated using (true);
create policy "admins manage department lines" on public.department_lines
for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "authenticated read agents" on public.agents
for select to authenticated using (true);
create policy "authenticated read customers" on public.zendesk_customers
for select to authenticated using (true);
create policy "authenticated read memberships" on public.agent_group_memberships
for select to authenticated using (true);
create policy "authenticated read calls" on public.calls
for select to authenticated using (true);
create policy "authenticated read call legs" on public.call_legs
for select to authenticated using (true);
create policy "authenticated read live status" on public.agent_live_status
for select to authenticated using (true);
create policy "authenticated read queue snapshots" on public.queue_snapshots
for select to authenticated using (true);
create policy "admins read sync state" on public.sync_state
for select to authenticated using (public.is_admin());
create policy "admins read sync runs" on public.sync_runs
for select to authenticated using (public.is_admin());

alter publication supabase_realtime add table public.calls;
alter publication supabase_realtime add table public.agent_live_status;
