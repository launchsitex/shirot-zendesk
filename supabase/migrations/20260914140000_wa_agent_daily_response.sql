-- Extends "ביצועי WA" (wa_agent_daily) with the same "זמן תגובה נציגה" split
-- already live on דשבורד WA / TV WA (20260914130000_zendesk_assigned_to_agent_at,
-- CHANGELOG [2026-09-14]): the existing first_response_seconds_sum stays
-- exactly as is ("זמן תגובה מוקד" — handoff to the queue, including any time
-- unassigned), and two new columns add "זמן תגובה נציגה" — from the moment a
-- person was actually assigned (`assigned_to_agent_at`) to the same first
-- message. Purely additive: no existing column's value changes for any day,
-- past or future, so this needs no cutoff-date branch — both the frozen
-- pre-2026-09-14 branch and the current one gain the same two new columns,
-- computed the same way, credited to the same responder as
-- first_response_seconds_sum.
--
-- agent_responded_count can be lower than responded_count: assigned_to_agent_at
-- is null for tickets answered before 2026-09-09 (when zendesk_ticket_transitions
-- started) or answered before ever getting a real assignee transition — those
-- tickets count toward "מוקד" but not toward "נציגה".

alter table public.wa_agent_daily
  add column if not exists agent_response_seconds_sum bigint not null default 0;
alter table public.wa_agent_daily
  add column if not exists agent_responded_count integer not null default 0;

create or replace function public.recompute_wa_agent_daily(p_day date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start timestamptz := (p_day::timestamp) at time zone 'Asia/Jerusalem';
  v_end timestamptz := ((p_day + 1)::timestamp) at time zone 'Asia/Jerusalem';
  v_activity_day_cutoff constant date := '2026-09-14';
  v_rows integer;
begin
  delete from public.wa_agent_daily where day = p_day;

  if p_day < v_activity_day_cutoff then
    -- Original behavior for every pre-existing column, byte-for-byte:
    -- responded/closed follow the same cohort as ticket_count — tickets
    -- *opened* that day, whenever they were actually answered or closed.
    -- Only the two new agent_response_* columns are added.
    with tickets as (
      select
        t.agent_id,
        t.status in ('solved', 'closed') as is_closed,
        t.zendesk_created_at,
        coalesce(t.handed_to_agent_at, t.zendesk_created_at) as clock_start,
        t.assigned_to_agent_at,
        t.first_agent_message_at,
        coalesce(t.solved_at, t.zendesk_updated_at) as closed_at,
        coalesce(
          t.first_response_agent_id,
          case when t.first_agent_message_at is not null then t.agent_id end
        ) as responder_id,
        coalesce(
          t.solved_by_agent_id,
          case when t.status in ('solved', 'closed') then t.agent_id end
        ) as closer_id
      from public.zendesk_tickets t
      where t.via_channel = 'whatsapp'
        and t.status <> 'deleted'
        and t.zendesk_created_at >= v_start
        and t.zendesk_created_at < v_end
    ),
    roster as (
      select a.id, a.department_id, h.schedule
      from public.agents a
      left join public.department_business_hours h on h.department_id = a.department_id
      where a.department_id is not null
    ),
    assigned as (
      select agent_id,
        count(*)::integer as ticket_count,
        count(*) filter (where not is_closed)::integer as open_count
      from tickets
      where agent_id is not null
      group by agent_id
    ),
    responses as (
      select t.responder_id as agent_id,
        public.business_seconds(t.clock_start, t.first_agent_message_at, r.schedule) as seconds
      from tickets t
      join roster r on r.id = t.responder_id
      where t.first_agent_message_at is not null
    ),
    responded as (
      select agent_id,
        count(*)::integer as responded_count,
        sum(seconds)::bigint as first_response_seconds_sum,
        count(*) filter (where seconds < 180)::integer as under_3_count,
        count(*) filter (where seconds >= 180)::integer as over_3_count,
        count(*) filter (where seconds >= 420)::integer as over_7_count,
        count(*) filter (where seconds >= 600)::integer as over_10_count
      from responses
      group by agent_id
    ),
    agent_responses as (
      select t.responder_id as agent_id,
        public.business_seconds(t.assigned_to_agent_at, t.first_agent_message_at, r.schedule) as seconds
      from tickets t
      join roster r on r.id = t.responder_id
      where t.first_agent_message_at is not null and t.assigned_to_agent_at is not null
    ),
    agent_responded as (
      select agent_id,
        count(*)::integer as agent_responded_count,
        sum(seconds)::bigint as agent_response_seconds_sum
      from agent_responses
      group by agent_id
    ),
    closures as (
      select t.closer_id as agent_id,
        public.business_seconds(t.zendesk_created_at, t.closed_at, r.schedule) as seconds
      from tickets t
      join roster r on r.id = t.closer_id
      where t.is_closed
    ),
    closed as (
      select agent_id,
        count(*)::integer as closed_count,
        sum(seconds)::bigint as time_to_close_seconds_sum
      from closures
      group by agent_id
    ),
    agent_ids as (
      select agent_id from assigned
      union select agent_id from responded
      union select agent_id from closed
    )
    insert into public.wa_agent_daily (
      day, department_id, agent_id,
      ticket_count, open_count,
      closed_count, time_to_close_seconds_sum,
      responded_count, first_response_seconds_sum,
      agent_responded_count, agent_response_seconds_sum,
      under_3_count, over_3_count, over_7_count, over_10_count,
      computed_at
    )
    select
      p_day, r.department_id, r.id,
      coalesce(a.ticket_count, 0), coalesce(a.open_count, 0),
      coalesce(c.closed_count, 0), coalesce(c.time_to_close_seconds_sum, 0),
      coalesce(f.responded_count, 0), coalesce(f.first_response_seconds_sum, 0),
      coalesce(g.agent_responded_count, 0), coalesce(g.agent_response_seconds_sum, 0),
      coalesce(f.under_3_count, 0), coalesce(f.over_3_count, 0),
      coalesce(f.over_7_count, 0), coalesce(f.over_10_count, 0),
      now()
    from agent_ids ids
    join roster r on r.id = ids.agent_id
    left join assigned a on a.agent_id = ids.agent_id
    left join responded f on f.agent_id = ids.agent_id
    left join agent_responded g on g.agent_id = ids.agent_id
    left join closed c on c.agent_id = ids.agent_id;
  else
    -- From 2026-09-14: ticket_count/open_count still follow tickets *opened*
    -- that day, but responded/closed follow tickets *answered*/*solved* that
    -- day regardless of when they were opened (unchanged). The two new
    -- agent_response_* columns follow the same "answered that day" cohort.
    with tickets as (
      select
        t.agent_id,
        t.status in ('solved', 'closed') as is_closed
      from public.zendesk_tickets t
      where t.via_channel = 'whatsapp'
        and t.status <> 'deleted'
        and t.zendesk_created_at >= v_start
        and t.zendesk_created_at < v_end
    ),
    activity as (
      select
        t.status in ('solved', 'closed') as is_closed,
        coalesce(t.handed_to_agent_at, t.zendesk_created_at) as clock_start,
        t.assigned_to_agent_at,
        t.zendesk_created_at,
        t.first_agent_message_at,
        coalesce(t.solved_at, t.zendesk_updated_at) as closed_at,
        coalesce(
          t.first_response_agent_id,
          case when t.first_agent_message_at is not null then t.agent_id end
        ) as responder_id,
        coalesce(
          t.solved_by_agent_id,
          case when t.status in ('solved', 'closed') then t.agent_id end
        ) as closer_id
      from public.zendesk_tickets t
      where t.via_channel = 'whatsapp'
        and t.status <> 'deleted'
    ),
    roster as (
      select a.id, a.department_id, h.schedule
      from public.agents a
      left join public.department_business_hours h on h.department_id = a.department_id
      where a.department_id is not null
    ),
    assigned as (
      select agent_id,
        count(*)::integer as ticket_count,
        count(*) filter (where not is_closed)::integer as open_count
      from tickets
      where agent_id is not null
      group by agent_id
    ),
    responses as (
      select t.responder_id as agent_id,
        public.business_seconds(t.clock_start, t.first_agent_message_at, r.schedule) as seconds
      from activity t
      join roster r on r.id = t.responder_id
      where t.first_agent_message_at >= v_start and t.first_agent_message_at < v_end
    ),
    responded as (
      select agent_id,
        count(*)::integer as responded_count,
        sum(seconds)::bigint as first_response_seconds_sum,
        count(*) filter (where seconds < 180)::integer as under_3_count,
        count(*) filter (where seconds >= 180)::integer as over_3_count,
        count(*) filter (where seconds >= 420)::integer as over_7_count,
        count(*) filter (where seconds >= 600)::integer as over_10_count
      from responses
      group by agent_id
    ),
    agent_responses as (
      select t.responder_id as agent_id,
        public.business_seconds(t.assigned_to_agent_at, t.first_agent_message_at, r.schedule) as seconds
      from activity t
      join roster r on r.id = t.responder_id
      where t.first_agent_message_at >= v_start and t.first_agent_message_at < v_end
        and t.assigned_to_agent_at is not null
    ),
    agent_responded as (
      select agent_id,
        count(*)::integer as agent_responded_count,
        sum(seconds)::bigint as agent_response_seconds_sum
      from agent_responses
      group by agent_id
    ),
    closures as (
      select t.closer_id as agent_id,
        public.business_seconds(t.zendesk_created_at, t.closed_at, r.schedule) as seconds
      from activity t
      join roster r on r.id = t.closer_id
      where t.is_closed and t.closed_at >= v_start and t.closed_at < v_end
    ),
    closed as (
      select agent_id,
        count(*)::integer as closed_count,
        sum(seconds)::bigint as time_to_close_seconds_sum
      from closures
      group by agent_id
    ),
    agent_ids as (
      select agent_id from assigned
      union select agent_id from responded
      union select agent_id from closed
    )
    insert into public.wa_agent_daily (
      day, department_id, agent_id,
      ticket_count, open_count,
      closed_count, time_to_close_seconds_sum,
      responded_count, first_response_seconds_sum,
      agent_responded_count, agent_response_seconds_sum,
      under_3_count, over_3_count, over_7_count, over_10_count,
      computed_at
    )
    select
      p_day, r.department_id, r.id,
      coalesce(a.ticket_count, 0), coalesce(a.open_count, 0),
      coalesce(c.closed_count, 0), coalesce(c.time_to_close_seconds_sum, 0),
      coalesce(f.responded_count, 0), coalesce(f.first_response_seconds_sum, 0),
      coalesce(g.agent_responded_count, 0), coalesce(g.agent_response_seconds_sum, 0),
      coalesce(f.under_3_count, 0), coalesce(f.over_3_count, 0),
      coalesce(f.over_7_count, 0), coalesce(f.over_10_count, 0),
      now()
    from agent_ids ids
    join roster r on r.id = ids.agent_id
    left join assigned a on a.agent_id = ids.agent_id
    left join responded f on f.agent_id = ids.agent_id
    left join agent_responded g on g.agent_id = ids.agent_id
    left join closed c on c.agent_id = ids.agent_id;
  end if;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

comment on table public.wa_agent_daily is
  'Daily WhatsApp performance per agent (Israel calendar day the ticket was opened, for ticket_count/open_count). From 2026-09-14, responded_count/closed_count instead follow the day the reply/close actually happened, whatever day the ticket opened; before that date they follow the ticket''s opening day like ticket_count. agent_response_seconds_sum/agent_responded_count ("זמן תגובה נציגה") are additive on every day, past and future: from the moment a person was actually assigned (assigned_to_agent_at) rather than the bot''s handoff to the queue (first_response_seconds_sum, "זמן תגובה מוקד", unchanged). Recomputed by recompute_wa_agent_daily; durations on the business clock.';

-- Backfill every day the table already covers, same range as the original
-- backfill (20260909300000_wa_agent_daily) — safe because no existing
-- column's value changes, only the two new ones are populated.
select public.recompute_wa_agent_daily(d::date)
from generate_series('2026-08-01'::date, (now() at time zone 'Asia/Jerusalem')::date, interval '1 day') d;
