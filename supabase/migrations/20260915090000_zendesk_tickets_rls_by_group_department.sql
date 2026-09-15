-- The read policy on zendesk_tickets scoped visibility by the ASSIGNED
-- AGENT's department (agents.department_id via zendesk_tickets.agent_id).
-- An unassigned ticket has agent_id null, so that EXISTS check can never
-- match — a non-admin viewer could never see "ממתינים לשיוך נציגה" (the
-- unassigned queue), on the TV wallboard or anywhere else, since every
-- other part of the app (API routes, wa_agent_daily, today's
-- wa_department_daily_interactions) scopes a ticket's department by its
-- Zendesk routing GROUP (zendesk_group_departments), not by whoever is
-- currently assigned. Bug report: account owner, 2026-09-15 — TV showed 15
-- waiting for an admin session and 0 for a viewer session on the same URL.

alter policy "department scoped read zendesk tickets"
on public.zendesk_tickets
using (
  (select is_admin())
  or (select private.current_department_id()) is null
  or exists (
    select 1
    from public.zendesk_group_departments zgd
    where zgd.group_id = zendesk_tickets.group_id
      and zgd.department_id = (select private.current_department_id())
  )
);
