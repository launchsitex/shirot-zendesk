-- "יעדים לנציגים": a daily inbound-call target per (agent, department), the
-- 15:30 Hebrew report that measures progress against it, and the one SQL
-- definition of the metric that both the app and the email read from.
--
-- The metric (decided with the customer 2026-08-02):
--   inbound + answered + agent_id = X, MINUS rows where
--   transferred_by_agent_id = X — the calls X transferred away.
--
-- Why that expression, and not something about transfers in general: Aircall
-- records the two transfer flavors completely differently.
--   * Internal transfer to another agent — ownership moves, agent_id becomes
--     the destination agent. The transferring agent already drops out on its
--     own, with no help from this filter (17 rows in the data so far).
--   * External transfer — agent_id stays with the agent and the webhook also
--     stamps them as the transferrer, so transferred_by_agent_id = agent_id
--     (503 rows, ~11% of answered inbound). Those are the ones this subtracts.
-- A call transferred *to* an agent still counts for them, as requested.
--
-- Grouping is by the CALL's department_id, not the agent's home department:
-- eight agents answer for both departments and carry a separate target in each.

-- ---------------------------------------------------------------- targets ---

-- department_id is NOT NULL: a target is always "this agent, in this
-- department". Calls that arrive unrouted still show up in the report under
-- "ללא שיוך מחלקה", they just never carry a target. Keeping the column
-- non-null buys a plain unique constraint, which the bulk-save endpoint needs
-- as an ON CONFLICT target (PostgREST cannot use a functional index for that).
create table if not exists public.agent_call_targets (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null references public.agents(id) on delete cascade,
  department_id text not null references public.departments(id) on delete cascade,
  daily_inbound_target integer not null check (daily_inbound_target >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  constraint agent_call_targets_agent_department_uniq unique (agent_id, department_id)
);

alter table public.agent_call_targets enable row level security;

-- Reads follow the same department scoping as calls/agents (see
-- 20260730200000_department_scoped_rls.sql): a scoped viewer sees only their
-- own department's targets. Writes are admin-only.
create policy "department scoped read agent call targets"
  on public.agent_call_targets
  for select to authenticated
  using (
    (select public.is_admin())
    or (select private.current_department_id()) is null
    or department_id = (select private.current_department_id())
  );

create policy "admins write agent call targets"
  on public.agent_call_targets
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ------------------------------------------------------- report settings ---

create table if not exists public.agent_target_report_settings (
  id integer primary key default 1 check (id = 1),
  enabled boolean not null default true,
  -- Kept in the row rather than hard-coded so the send time can move without a
  -- deploy; the cron guard reads it. 15:30 Asia/Jerusalem as specified.
  send_local_time time not null default '15:30',
  -- Set by the report function after a successful send. Doubles as the
  -- idempotency key: the job fires twice a day (see the cron note below) and
  -- the second run must not send a duplicate.
  last_sent_on date,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

insert into public.agent_target_report_settings (id)
values (1)
on conflict (id) do nothing;

alter table public.agent_target_report_settings enable row level security;

create policy "admins read agent target report settings"
  on public.agent_target_report_settings
  for select to authenticated
  using ((select public.is_admin()));

create policy "admins write agent target report settings"
  on public.agent_target_report_settings
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create table if not exists public.agent_target_report_recipients (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

alter table public.agent_target_report_recipients enable row level security;

create policy "admins read agent target report recipients"
  on public.agent_target_report_recipients
  for select to authenticated
  using ((select public.is_admin()));

create policy "admins write agent target report recipients"
  on public.agent_target_report_recipients
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ---------------------------------------------------------- the metric ------

-- SECURITY INVOKER on purpose: called from the app it inherits the caller's
-- RLS, so a department-scoped viewer gets only their own rows; called from the
-- Edge Function it runs as service_role and sees everything for the email.
create or replace function public.agent_target_report(
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  department_id text,
  department_name text,
  agent_id text,
  agent_name text,
  daily_inbound_target integer,
  inbound_answered bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with actual as (
    select
      c.department_id as dept_id,
      c.agent_id as ag_id,
      count(*) as n
    from public.calls c
    where c.direction = 'inbound'
      and c.status = 'answered'
      and c.agent_id is not null
      and c.started_at >= p_from
      and c.started_at < p_to
      -- The agent handed this call off; it is not theirs to count.
      and (
        c.transferred_by_agent_id is null
        or c.transferred_by_agent_id <> c.agent_id
      )
    group by 1, 2
  ),
  -- An agent with a target but no calls yet must still appear (at 0), and an
  -- agent taking calls without a target must appear too, so the report is the
  -- union of both sides rather than either one alone.
  keys as (
    select dept_id, ag_id from actual
    union
    select t.department_id, t.agent_id from public.agent_call_targets t
  )
  select
    k.dept_id,
    d.name,
    k.ag_id,
    a.name,
    t.daily_inbound_target,
    coalesce(x.n, 0)
  from keys k
  join public.agents a on a.id = k.ag_id
  left join public.departments d on d.id = k.dept_id
  left join actual x
    on x.ag_id = k.ag_id
   and x.dept_id is not distinct from k.dept_id
  left join public.agent_call_targets t
    on t.agent_id = k.ag_id
   and t.department_id is not distinct from k.dept_id
  order by d.name nulls last, a.name;
$$;

grant execute on function public.agent_target_report(timestamptz, timestamptz)
  to authenticated, service_role;
