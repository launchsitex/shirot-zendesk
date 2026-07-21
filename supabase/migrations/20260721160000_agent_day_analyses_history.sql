-- Persist every agent-day AI analysis so the page can show an analysis
-- history. Rows are written by the analyze-agent-day edge function (service
-- role); admins read them from the app.

create table if not exists public.agent_day_analyses (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null references public.agents (id) on delete cascade,
  agent_name text not null,
  analysis_date date not null,
  analyzed_at timestamptz not null default now(),
  analyzed_by uuid references auth.users (id) on delete set null,
  overall_score integer,
  calls_analyzed integer not null default 0,
  skipped_recordings integer not null default 0,
  stats jsonb not null default '{}'::jsonb,
  status_summary jsonb not null default '[]'::jsonb,
  analyzed_calls jsonb not null default '[]'::jsonb,
  analysis jsonb not null,
  model text
);

create index if not exists agent_day_analyses_agent_idx
  on public.agent_day_analyses (agent_id, analyzed_at desc);
create index if not exists agent_day_analyses_analyzed_at_idx
  on public.agent_day_analyses (analyzed_at desc);

alter table public.agent_day_analyses enable row level security;

drop policy if exists "admins read agent day analyses"
  on public.agent_day_analyses;
create policy "admins read agent day analyses"
  on public.agent_day_analyses
  for select
  to authenticated
  using (public.is_admin());
