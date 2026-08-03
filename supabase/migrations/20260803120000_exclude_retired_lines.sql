-- Applied to the live project on 2026-08-03.
--
-- The call centre moved to new Aircall numbers on 2026-07-26. The old numbers
-- were renamed "- ישן" and had their teams removed, but were left OPEN, so they
-- still accept calls that then ring nobody: Aircall emits call.created, plays
-- hold music, and nothing else ever happens. Callers sat on hold for 25+
-- minutes while agents were free, and the wallboard correctly showed them as
-- waiting — there was no bug in the app to fix.
--
-- Those calls are not call centre traffic and must not be counted or shown.
-- Note this only hides them; the real fix is closing or forwarding the two
-- numbers in Aircall, and correcting the transfer target agents use.
--
-- The cutoff is the migration instant, not "now": before it these were the live
-- lines and carried 6,576 genuine calls, and erasing those would gut every
-- report for July. Only the 74 strays that landed after the migration drop out.

alter table public.talk_lines
  add column if not exists excluded_from timestamptz;

comment on column public.talk_lines.excluded_from is
  'When set, calls on this line that started at or after this instant are excluded from all counting and display. Traffic before it stays visible — used when a number is retired but keeps receiving strays.';

update public.talk_lines
set excluded_from = timestamptz '2026-07-26 15:00:00+00'
where id in ('1325898', '1322427');

-- department_lines is deliberately left alone: the mapping is what stamped
-- department_id on the historical rows, and a re-sync must keep resolving it
-- the same way or July's attribution would drift.

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
      -- Retired lines stop counting from the moment they were retired.
      and not exists (
        select 1 from public.talk_lines tl
        where tl.id = c.line_id
          and tl.excluded_from is not null
          and c.started_at >= tl.excluded_from
      )
    group by 1, 2
  ),
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
