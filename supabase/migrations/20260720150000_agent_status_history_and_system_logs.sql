-- Agent status duration history (from now on)
create table if not exists public.agent_status_history (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null references public.agents(id) on delete cascade,
  state text not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  source_event text,
  created_at timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);

create index if not exists agent_status_history_agent_started_idx
  on public.agent_status_history (agent_id, started_at desc);

create index if not exists agent_status_history_open_idx
  on public.agent_status_history (agent_id)
  where ended_at is null;

create index if not exists agent_status_history_range_idx
  on public.agent_status_history (started_at, ended_at);

-- System / reliability event log
create table if not exists public.system_event_logs (
  id uuid primary key default gen_random_uuid(),
  severity text not null check (severity in ('info', 'warning', 'error')),
  category text not null,
  title text not null,
  message text not null,
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists system_event_logs_occurred_idx
  on public.system_event_logs (occurred_at desc);

create index if not exists system_event_logs_severity_idx
  on public.system_event_logs (severity, occurred_at desc);

alter table public.agent_status_history enable row level security;
alter table public.system_event_logs enable row level security;

drop policy if exists "authenticated read agent status history" on public.agent_status_history;
create policy "authenticated read agent status history"
  on public.agent_status_history
  for select to authenticated
  using (true);

drop policy if exists "service role manage agent status history" on public.agent_status_history;
create policy "service role manage agent status history"
  on public.agent_status_history
  for all to service_role
  using (true)
  with check (true);

drop policy if exists "admins read system event logs" on public.system_event_logs;
create policy "admins read system event logs"
  on public.system_event_logs
  for select to authenticated
  using (public.is_admin());

drop policy if exists "service role manage system event logs" on public.system_event_logs;
create policy "service role manage system event logs"
  on public.system_event_logs
  for all to service_role
  using (true)
  with check (true);

-- Open a current segment for every live agent status we already know.
insert into public.agent_status_history (agent_id, state, started_at, ended_at, source_event)
select
  live.agent_id,
  live.state,
  coalesce(live.state_since, live.updated_at, now()),
  null,
  'backfill-current'
from public.agent_live_status as live
where not exists (
  select 1
  from public.agent_status_history as history
  where history.agent_id = live.agent_id
    and history.ended_at is null
);

insert into public.system_event_logs (severity, category, title, message, details)
values (
  'info',
  'system',
  'הופעל מעקב סטטוסים ולוג מערכת',
  'מעכשיו המערכת שומרת היסטוריית סטטוסי נציגים ויומן אירועי תקלות.',
  jsonb_build_object('feature', 'agent_status_history')
);
