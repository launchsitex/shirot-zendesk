-- Priority-pull automation: a "request" queue the dashboard writes to, and a
-- scheduled background routine (not this app's server) drains by running the
-- same delivery+order join/filter/insert flow that was previously done by
-- hand in a Claude Code session.

alter table public.survey_pending_sends
  add column if not exists delivered_at date;

create table if not exists public.survey_priority_pull_requests (
  id uuid primary key default gen_random_uuid(),
  date_from date not null,
  date_to date not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'done', 'error')),
  requested_by uuid references public.profiles(id) on delete set null,
  inserted_count integer,
  matched_count integer,
  result_summary text,
  error_message text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists survey_priority_pull_requests_status_idx
  on public.survey_priority_pull_requests (status, created_at);

alter table public.survey_priority_pull_requests enable row level security;

create policy "survey_priority_pull_requests_all"
  on public.survey_priority_pull_requests
  for all
  to authenticated
  using (true)
  with check (true);
