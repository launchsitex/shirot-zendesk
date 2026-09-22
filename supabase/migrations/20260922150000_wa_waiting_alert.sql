-- Email alert when a WhatsApp ticket has been waiting on an agent past a
-- threshold, on the business clock — same "מעל 10 דק'" definition already
-- used across the WA screens (WAITING_TIER_MINUTES in src/lib/wa-dashboard.ts).
-- Reuses the existing missed-call notification recipients/from-address
-- (account owner, 2026-09-22: same people should see both).
--
-- Unlike the missed-call alert, there is no single row-transition event to
-- hang a trigger off — a ticket becomes alert-worthy purely by sitting idle
-- long enough. So this is polled: a pg_cron job every 5 minutes calls
-- find_wa_waiting_alerts(), and the edge function notify-wa-waiting emails
-- whatever it returns, then stamps each ticket's waiting_alert_sent_for so
-- the same wait is never emailed twice — but a *new* wait (the agent replied
-- and the customer wrote again) has a new customer_waiting_since and alerts
-- again.

alter table public.zendesk_tickets
  add column if not exists waiting_alert_sent_for timestamptz;

-- Mirrors mapTicketRow's `waitingSince` in src/app/api/wa-dashboard/route.ts
-- exactly (status/custom-status gate, the no-agent-reply-yet fallback with
-- its 2026-09-08 cutoff, otherwise the stored customer_waiting_since) — keep
-- the two in sync if that logic ever changes. business_seconds() is the SQL
-- twin of src/lib/business-clock.ts, already used for every other WA figure.
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

revoke all on function public.find_wa_waiting_alerts(integer) from public;
grant execute on function public.find_wa_waiting_alerts(integer) to service_role;

select cron.schedule(
  'wa-waiting-alert-every-5-minutes',
  '*/5 * * * *',
  $$
    select net.http_post(
      url := (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'project_url'
      ) || '/functions/v1/notify-wa-waiting',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-sync-secret', (
          select decrypted_secret from vault.decrypted_secrets
          where name = 'sync_function_secret'
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
  $$
);
