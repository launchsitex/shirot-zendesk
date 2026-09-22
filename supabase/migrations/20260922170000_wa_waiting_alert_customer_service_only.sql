-- Account owner, 2026-09-22: scope the "מעל 10 דק'" waiting alert to
-- שירות לקוחות only, not every department. Replaces find_wa_waiting_alerts
-- from 20260922150000_wa_waiting_alert.sql with the same body plus one
-- department filter.

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
  with default_status as (
    select id from public.zendesk_custom_statuses
    where status_category = 'open' and is_default = true
    limit 1
  ),
  candidates as (
    select
      zt.id as ticket_id,
      zt.requester_name as customer_name,
      a.name as agent_name,
      d.name as department_name,
      dbh.schedule as schedule,
      case
        when zt.status <> 'open' then null
        when zt.custom_status_id is not null
             and (select id from default_status) is not null
             and zt.custom_status_id <> (select id from default_status)
          then null
        when zt.last_agent_message_at is null then
          case
            when zt.zendesk_created_at >= '2026-09-08T00:00:00+03:00'::timestamptz
              then coalesce(zt.handed_to_agent_at, zt.zendesk_created_at)
            else null
          end
        else zt.customer_waiting_since
      end as effective_waiting_since,
      zt.waiting_alert_sent_for
    from public.zendesk_tickets zt
    left join public.agents a on a.id = zt.agent_id
    left join public.departments d on d.id = a.department_id
    left join public.department_business_hours dbh on dbh.department_id = d.id
    where zt.via_channel = 'whatsapp' and zt.status = 'open'
      -- A ticket with no agent (so no department) is excluded by this same
      -- condition — fine here, since this alert is only about an
      -- already-assigned ticket going quiet, not the unassigned queue.
      and d.id = 'customer-service'
  )
  select
    c.ticket_id, c.customer_name, c.agent_name, c.department_name,
    c.effective_waiting_since,
    public.business_seconds(c.effective_waiting_since, now(), c.schedule) as wait_seconds
  from candidates c
  where c.effective_waiting_since is not null
    and c.waiting_alert_sent_for is distinct from c.effective_waiting_since
    and public.business_seconds(c.effective_waiting_since, now(), c.schedule) >= p_threshold_seconds;
$$;
