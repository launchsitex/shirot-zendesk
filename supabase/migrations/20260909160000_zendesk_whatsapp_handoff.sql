-- First response is measured from the moment the bot handed the conversation
-- to the agents, not from the ticket's creation: the AI agent handles the
-- start of every WhatsApp conversation, and the customer only starts waiting
-- for a person once it escalates. Zendesk records that moment as an
-- `OfferedToEvent` (the conversation offered to agents) in the same
-- ticket_events stream the sync already reads — e.g. ticket 70637 on
-- 2026-09-09: opened 05:48, bot until 06:03:37 (OfferedToEvent), agent's
-- first message 06:04:27 — 50 seconds, not 16 minutes.
--
-- Stored as a third direction in the flips table; the first one per ticket
-- is the handoff (a re-offer, if nobody picks up, comes later).

alter table public.zendesk_whatsapp_messages
  drop constraint if exists zendesk_whatsapp_messages_direction_check;
alter table public.zendesk_whatsapp_messages
  add constraint zendesk_whatsapp_messages_direction_check
  check (direction in ('agent', 'customer', 'handoff'));

alter table public.zendesk_tickets
  add column if not exists handed_to_agent_at timestamptz;

create or replace function public.recompute_whatsapp_activity(
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
  with tallies as (
    select
      t.id,
      min(m.at) filter (where m.direction = 'handoff') as handed,
      min(m.at) filter (where m.direction = 'agent') as first_agent,
      max(m.at) filter (where m.direction = 'agent') as last_agent,
      max(m.at) filter (where m.direction = 'customer') as last_customer
    from public.zendesk_tickets t
    left join public.zendesk_whatsapp_messages m on m.ticket_id = t.id
    where t.id = any (p_ticket_ids)
    group by t.id
  ),
  waits as (
    select tallies.id, min(m.at) as since
    from tallies
    join public.zendesk_whatsapp_messages m on m.ticket_id = tallies.id
    where m.direction = 'customer'
      and (tallies.last_agent is null or m.at > tallies.last_agent)
    group by tallies.id
  )
  update public.zendesk_tickets t
  set
    handed_to_agent_at = tallies.handed,
    first_agent_message_at = tallies.first_agent,
    last_agent_message_at = tallies.last_agent,
    last_customer_message_at = tallies.last_customer,
    customer_waiting_since = waits.since
  from tallies
  left join waits on waits.id = tallies.id
  where t.id = tallies.id
    and (
      t.handed_to_agent_at is distinct from tallies.handed
      or t.first_agent_message_at is distinct from tallies.first_agent
      or t.last_agent_message_at is distinct from tallies.last_agent
      or t.last_customer_message_at is distinct from tallies.last_customer
      or t.customer_waiting_since is distinct from waits.since
    );

  get diagnostics touched = row_count;
  return touched;
end;
$$;
