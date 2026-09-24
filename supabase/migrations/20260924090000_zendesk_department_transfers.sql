-- Fixes the root cause found 2026-09-24: "תגובה מוקד" measures from a
-- ticket's original bot handoff/creation, but a ticket that started in one
-- department's queue (e.g. אספקות) and was later moved into שירות לקוחות
-- keeps that original, much-earlier clock start once it lands with a
-- customer-service agent — inflating the department's average for a wait
-- the department never actually owned. Confirmed on ~10 tickets across
-- 2026-09-22/23 where the agent replied within minutes of the *transfer*,
-- not within hours of the ticket's original creation. Account owner,
-- 2026-09-24: fix going forward only, do not touch historical figures.
--
-- The normal sync already tracks status/assignee changes in
-- zendesk_ticket_transitions but drops group_id (routing) changes — this
-- starts capturing those too (kind = 'group', value = the new group_id;
-- same shape as the existing 'assignee' rows, no schema change needed).

alter table public.zendesk_tickets
  add column if not exists entered_department_at timestamptz,
  add column if not exists transferred_from_department_name text;

comment on column public.zendesk_tickets.entered_department_at is
  'Last time this ticket''s Zendesk group changed to one mapped to its current agent''s department (zendesk_group_departments). Null if it was never transferred into that department — i.e. handed_to_agent_at/zendesk_created_at already reflect the right clock start. Feeds "תגובה מוקד" via mapTicketRow in src/app/api/wa-dashboard/route.ts.';
comment on column public.zendesk_tickets.transferred_from_department_name is
  'Department name the ticket was routed through immediately before entered_department_at, for display only ("הועברה מ-X ב-HH:MM"). Null when entered_department_at is null.';

create or replace function public.recompute_ticket_transitions(p_ticket_ids text[])
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  touched integer;
begin
  with solved as (
    select ticket_id, max(at) as solved_at
    from public.zendesk_ticket_transitions
    where ticket_id = any (p_ticket_ids) and kind = 'status' and value = 'solved'
    group by ticket_id
  ),
  opened as (
    select ticket_id, max(at) as last_opened_at
    from public.zendesk_ticket_transitions
    where ticket_id = any (p_ticket_ids) and kind = 'status' and value = 'open'
    group by ticket_id
  ),
  -- Every group-routing change for these tickets, paired with the
  -- department it landed in (null if that group isn't mapped).
  group_moves as (
    select
      x.ticket_id,
      x.at,
      x.value as group_id,
      gd.department_id
    from public.zendesk_ticket_transitions x
    left join public.zendesk_group_departments gd on gd.group_id = x.value
    where x.ticket_id = any (p_ticket_ids) and x.kind = 'group'
  ),
  computed as (
    select
      t.id,
      s.solved_at,
      o.last_opened_at,
      coalesce(
        (select public.agent_for_zendesk_user(x.value)
           from public.zendesk_ticket_transitions x
          where x.ticket_id = t.id and x.kind = 'assignee'
            and x.at <= t.first_agent_message_at and x.value <> ''
          order by x.at desc limit 1),
        case when t.first_agent_message_at is not null then t.agent_id end
      ) as first_response_agent_id,
      coalesce(
        (select public.agent_for_zendesk_user(x.value)
           from public.zendesk_ticket_transitions x
          where x.ticket_id = t.id and x.kind = 'assignee'
            and x.at <= s.solved_at and x.value <> ''
          order by x.at desc limit 1),
        case when s.solved_at is not null then t.agent_id end
      ) as solved_by_agent_id,
      (select x.at
         from public.zendesk_ticket_transitions x
        where x.ticket_id = t.id and x.kind = 'assignee'
          and x.value <> '' and x.value <> '0'
          and x.at <= t.first_agent_message_at
        order by x.at desc limit 1) as assigned_to_agent_at,
      entry.entered_at as entered_department_at,
      prev_dept.name as transferred_from_department_name
    from public.zendesk_tickets t
    left join solved s on s.ticket_id = t.id
    left join opened o on o.ticket_id = t.id
    -- Latest move into a group mapped to the ticket's *current* agent's
    -- department. Absent when it never moved (or moved but not into that
    -- department) — the existing handoff/created_at clock start stands.
    left join lateral (
      select gm.at as entered_at, gm.ticket_id
        from group_moves gm
        join public.agents ag on ag.id = t.agent_id
       where gm.ticket_id = t.id and gm.department_id = ag.department_id
       order by gm.at desc limit 1
    ) entry on true
    -- The department the ticket was routed through immediately before that
    -- move, for display only.
    left join lateral (
      select gm2.department_id
        from group_moves gm2
       where gm2.ticket_id = entry.ticket_id and gm2.at < entry.entered_at
       order by gm2.at desc limit 1
    ) prev_move on entry.entered_at is not null
    left join public.departments prev_dept on prev_dept.id = prev_move.department_id
    where t.id = any (p_ticket_ids)
  )
  update public.zendesk_tickets t
  set
    solved_at = c.solved_at,
    first_response_agent_id = c.first_response_agent_id,
    solved_by_agent_id = c.solved_by_agent_id,
    assigned_to_agent_at = c.assigned_to_agent_at,
    last_opened_at = c.last_opened_at,
    entered_department_at = c.entered_department_at,
    transferred_from_department_name = c.transferred_from_department_name
  from computed c
  where t.id = c.id
    and (
      t.solved_at is distinct from c.solved_at
      or t.first_response_agent_id is distinct from c.first_response_agent_id
      or t.solved_by_agent_id is distinct from c.solved_by_agent_id
      or t.assigned_to_agent_at is distinct from c.assigned_to_agent_at
      or t.last_opened_at is distinct from c.last_opened_at
      or t.entered_department_at is distinct from c.entered_department_at
      or t.transferred_from_department_name is distinct from c.transferred_from_department_name
    );

  get diagnostics touched = row_count;
  return touched;
end;
$function$;
