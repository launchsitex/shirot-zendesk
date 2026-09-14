-- "ביצועי WA" credited responded/closed by the day the *ticket opened*, same
-- as "נענו היום" did on the live dashboard until 2026-09-14 (see
-- 20260909300000_wa_agent_daily and CHANGELOG [2026-09-14]) — an agent who
-- answered or closed an older ticket today was invisible. The live dashboard
-- was already switched to crediting the day the reply/close actually
-- happened; this brings the stored record in line, but ONLY from
-- 2026-09-14 on. Before that date `recompute_wa_agent_daily` keeps its exact
-- original behavior forever, even though `wa-agent-daily-rollup-nightly`
-- re-runs it over the trailing 31 days every night — the account owner
-- explicitly did not want already-reported historical figures to shift
-- (2026-09-14).
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
    -- Original behavior, byte-for-byte: responded/closed follow the same
    -- cohort as ticket_count — tickets *opened* that day, whenever they were
    -- actually answered or closed.
    with tickets as (
      select
        t.agent_id,
        t.status in ('solved', 'closed') as is_closed,
        t.zendesk_created_at,
        coalesce(t.handed_to_agent_at, t.zendesk_created_at) as clock_start,
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
      under_3_count, over_3_count, over_7_count, over_10_count,
      computed_at
    )
    select
      p_day, r.department_id, r.id,
      coalesce(a.ticket_count, 0), coalesce(a.open_count, 0),
      coalesce(c.closed_count, 0), coalesce(c.time_to_close_seconds_sum, 0),
      coalesce(f.responded_count, 0), coalesce(f.first_response_seconds_sum, 0),
      coalesce(f.under_3_count, 0), coalesce(f.over_3_count, 0),
      coalesce(f.over_7_count, 0), coalesce(f.over_10_count, 0),
      now()
    from agent_ids ids
    join roster r on r.id = ids.agent_id
    left join assigned a on a.agent_id = ids.agent_id
    left join responded f on f.agent_id = ids.agent_id
    left join closed c on c.agent_id = ids.agent_id;
  else
    -- From 2026-09-14: ticket_count/open_count still follow tickets *opened*
    -- that day, but responded/closed follow tickets *answered*/*solved* that
    -- day regardless of when they were opened — a reply or a close today on
    -- a ticket from last week now counts on the day it actually happened
    -- (matches src/lib/wa-dashboard.ts WaExtraActivity on the live dashboard).
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
      under_3_count, over_3_count, over_7_count, over_10_count,
      computed_at
    )
    select
      p_day, r.department_id, r.id,
      coalesce(a.ticket_count, 0), coalesce(a.open_count, 0),
      coalesce(c.closed_count, 0), coalesce(c.time_to_close_seconds_sum, 0),
      coalesce(f.responded_count, 0), coalesce(f.first_response_seconds_sum, 0),
      coalesce(f.under_3_count, 0), coalesce(f.over_3_count, 0),
      coalesce(f.over_7_count, 0), coalesce(f.over_10_count, 0),
      now()
    from agent_ids ids
    join roster r on r.id = ids.agent_id
    left join assigned a on a.agent_id = ids.agent_id
    left join responded f on f.agent_id = ids.agent_id
    left join closed c on c.agent_id = ids.agent_id;
  end if;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

comment on table public.wa_agent_daily is
  'Daily WhatsApp performance per agent (Israel calendar day the ticket was opened, for ticket_count/open_count). From 2026-09-14, responded_count/closed_count instead follow the day the reply/close actually happened, whatever day the ticket opened; before that date they follow the ticket''s opening day like ticket_count. Recomputed by recompute_wa_agent_daily; durations on the business clock.';
