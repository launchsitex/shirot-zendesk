-- "דשבורד WA" / "דשבורד TV WA": live view of open WhatsApp tickets from
-- Zendesk, per agent and per hour.
--
-- Purely additive — no existing table, policy or function is touched. Reuses
-- zendesk_tickets.via_channel (added in
-- 20260809081626_zendesk_via_channel_and_undocumented_summary) and follows the
-- exact shape of zendesk_ticket_summary / zendesk_undocumented_summary:
-- SECURITY INVOKER so the caller's own department-scoped RLS applies inside
-- the function with no need to re-implement the scoping here.

-- Per-agent snapshot of currently open WhatsApp tickets. "Open" means not yet
-- solved/closed; "stale" means the ticket has gone p_stale_seconds without any
-- update (the only signal available — Zendesk's ticket export does not expose
-- per-message timestamps, so zendesk_updated_at is a proxy for "since the
-- customer's last message" rather than an exact figure).
create or replace function public.zendesk_whatsapp_agent_summary(
  p_stale_seconds integer default 600
)
returns table (
  agent_id text,
  agent_name text,
  department_name text,
  open_count bigint,
  stale_count bigint,
  oldest_waiting_seconds double precision
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    t.agent_id,
    coalesce(a.name, t.assignee_name, 'ללא שיוך נציג') as agent_name,
    d.name as department_name,
    count(*) as open_count,
    count(*) filter (
      where extract(epoch from (now() - t.zendesk_updated_at)) >= p_stale_seconds
    ) as stale_count,
    max(extract(epoch from (now() - t.zendesk_updated_at))) as oldest_waiting_seconds
  from public.zendesk_tickets t
  left join public.agents a on a.id = t.agent_id
  left join public.departments d on d.id = a.department_id
  where t.via_channel = 'whatsapp'
    and t.status not in ('solved', 'closed')
  group by 1, 2, 3
  order by stale_count desc, oldest_waiting_seconds desc nulls last, 2;
$$;

grant execute on function public.zendesk_whatsapp_agent_summary(integer)
  to authenticated, service_role;

-- Hourly volume of incoming WhatsApp tickets over the last p_hours, for the
-- dashboard's trend strip.
create or replace function public.zendesk_whatsapp_hourly_volume(
  p_hours integer default 24
)
returns table (
  hour_start timestamptz,
  ticket_count bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    date_trunc('hour', t.zendesk_created_at) as hour_start,
    count(*) as ticket_count
  from public.zendesk_tickets t
  where t.via_channel = 'whatsapp'
    and t.zendesk_created_at >= now() - (p_hours || ' hours')::interval
  group by 1
  order by 1;
$$;

grant execute on function public.zendesk_whatsapp_hourly_volume(integer)
  to authenticated, service_role;
