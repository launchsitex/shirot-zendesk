-- Splits "first response time" into two numbers, at the account owner's
-- request: ticket 74539 (2026-09-14) showed a 76-minute first response, but
-- the transitions show the bot handed it to the *unassigned* queue at 11:18,
-- it sat there until 12:28 when it was actually assigned to ירין אללוף, and
-- she answered at 12:35 — 7 minutes of her own time, not 76. The existing
-- figure (handed_to_agent_at -> first_agent_message_at, unchanged) measures
-- the customer's total wait including queue time and stays as "זמן תגובה
-- מוקד"; this adds "זמן תגובה נציגה" — from the moment she was actually
-- assigned. Shown separately, not merged: the account owner wants to see
-- both averages before deciding which one bonuses should use.
--
-- assigned_to_agent_at is the last real assignee transition (excluding the
-- bot's own clear-to-queue value '0'/'') at or before first_agent_message_at
-- — the same "who was assigned at that moment" logic already used for
-- first_response_agent_id in recompute_ticket_transitions, just keeping the
-- transition's timestamp instead of resolving it to an agent. Null when no
-- such transition exists (tickets from before 2026-09-09, when
-- zendesk_ticket_transitions started, or a ticket answered before ever
-- getting a real assignee).

alter table public.zendesk_tickets
  add column if not exists assigned_to_agent_at timestamptz;

create or replace function public.recompute_ticket_transitions(
  p_ticket_ids text[]
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  touched integer;
begin
  with solved as (
    select ticket_id, max(at) as solved_at
    from public.zendesk_ticket_transitions
    where ticket_id = any (p_ticket_ids) and kind = 'status' and value = 'solved'
    group by ticket_id
  ),
  computed as (
    select
      t.id,
      s.solved_at,
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
        order by x.at desc limit 1) as assigned_to_agent_at
    from public.zendesk_tickets t
    left join solved s on s.ticket_id = t.id
    where t.id = any (p_ticket_ids)
  )
  update public.zendesk_tickets t
  set
    solved_at = c.solved_at,
    first_response_agent_id = c.first_response_agent_id,
    solved_by_agent_id = c.solved_by_agent_id,
    assigned_to_agent_at = c.assigned_to_agent_at
  from computed c
  where t.id = c.id
    and (
      t.solved_at is distinct from c.solved_at
      or t.first_response_agent_id is distinct from c.first_response_agent_id
      or t.solved_by_agent_id is distinct from c.solved_by_agent_id
      or t.assigned_to_agent_at is distinct from c.assigned_to_agent_at
    );

  get diagnostics touched = row_count;
  return touched;
end;
$$;

-- Backfill every ticket that already has transitions stored.
select public.recompute_ticket_transitions(
  array(select distinct ticket_id from public.zendesk_ticket_transitions)
);
