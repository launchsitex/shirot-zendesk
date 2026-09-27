-- Account owner, 2026-09-27: replace the "assigned but no reply yet" alert
-- with the actually-requested case — a customer sitting completely
-- UNASSIGNED in the queue (status='new', no agent at all) for over the
-- threshold during business hours. Same table/dedup/edge-function/email
-- machinery as before (notify-wa-waiting already renders agent_name as
-- "ללא שיוך נציג" when null), only the underlying query changes.
--
-- Mirrors the exact "ממתינים לשיוך נציגה" queue definition already used
-- in src/app/api/wa-dashboard/route.ts (status='new' + assignee_id null),
-- department resolved via the ticket's own group (zendesk_group_departments)
-- since an unassigned ticket has no agent to derive it from.
create or replace function public.find_wa_waiting_alerts(p_threshold_seconds integer)
returns table (
  ticket_id text,
  customer_name text,
  agent_name text,
  department_name text,
  effective_waiting_since timestamptz,
  wait_seconds numeric
)
language sql
stable
as $$
  select
    zt.id as ticket_id,
    zt.requester_name as customer_name,
    null::text as agent_name,
    d.name as department_name,
    coalesce(zt.handed_to_agent_at, zt.zendesk_created_at) as effective_waiting_since,
    public.business_seconds(
      coalesce(zt.handed_to_agent_at, zt.zendesk_created_at),
      now(),
      dbh.schedule
    ) as wait_seconds
  from public.zendesk_tickets zt
  left join public.zendesk_group_departments gd on gd.group_id = zt.group_id
  left join public.departments d on d.id = gd.department_id
  left join public.department_business_hours dbh on dbh.department_id = gd.department_id
  where zt.via_channel = 'whatsapp'
    and zt.status = 'new'
    and zt.assignee_id is null
    and gd.department_id = 'customer-service'
    and zt.waiting_alert_sent_for is distinct from coalesce(zt.handed_to_agent_at, zt.zendesk_created_at)
    and public.business_seconds(
      coalesce(zt.handed_to_agent_at, zt.zendesk_created_at), now(), dbh.schedule
    ) >= p_threshold_seconds;
$$;
