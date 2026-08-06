-- Applied to the live project on 2026-08-06.
--
-- Adds inbound/outbound talk time per (agent, department) to the targets
-- report, for the two new columns on the "יעדים לנציגים" page.
--
-- Time is talk_time_seconds, not duration_seconds: on outbound, duration also
-- counts dialling and ringing, so a rep who dials thirty numbers that nobody
-- picks up would show hours of "call time" having spoken to no one.
--
-- Unlike the target count, the time columns include calls the agent later
-- transferred away. The target measures credit for handling a call; these
-- measure time spent on the phone, and the agent really did spend it.
--
-- DROP then CREATE rather than CREATE OR REPLACE — Postgres refuses to change
-- a function's return type in place. Both statements run in one migration, so
-- the function is never missing between them for another session. The argument
-- list is unchanged, so the app and the report Edge Function keep calling it
-- exactly as before; extra returned columns are ignored by callers that do not
-- select them.
drop function if exists public.agent_target_report(timestamptz, timestamptz);

create function public.agent_target_report(
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  department_id text,
  department_name text,
  agent_id text,
  agent_name text,
  daily_inbound_target integer,
  inbound_answered bigint,
  inbound_talk_seconds bigint,
  outbound_talk_seconds bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with in_window as (
    select
      c.department_id as dept_id,
      c.agent_id as ag_id,
      c.direction,
      c.status,
      c.talk_time_seconds,
      c.transferred_by_agent_id
    from public.calls c
    where c.agent_id is not null
      and c.started_at >= p_from
      and c.started_at < p_to
      -- Retired lines stop counting from the moment they were retired.
      and not exists (
        select 1 from public.talk_lines tl
        where tl.id = c.line_id
          and tl.excluded_from is not null
          and c.started_at >= tl.excluded_from
      )
  ),
  actual as (
    select
      dept_id,
      ag_id,
      count(*) filter (
        where direction = 'inbound'
          and status = 'answered'
          -- The agent handed this call off; it is not theirs to count.
          and (transferred_by_agent_id is null or transferred_by_agent_id <> ag_id)
      ) as answered,
      coalesce(sum(talk_time_seconds) filter (where direction = 'inbound'), 0) as inbound_seconds,
      coalesce(sum(talk_time_seconds) filter (where direction = 'outbound'), 0) as outbound_seconds
    from in_window
    group by 1, 2
  ),
  -- An agent with a target but no calls must still appear (at 0), and an agent
  -- with calls but no target must appear too.
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
    coalesce(x.answered, 0),
    coalesce(x.inbound_seconds, 0),
    coalesce(x.outbound_seconds, 0)
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
