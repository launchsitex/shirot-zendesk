-- Correction from the account owner: a waiting customer's clock starts at
-- their first message that has not been answered yet — not at the agent's
-- last message. That is the first customer flip after the agent's last one
-- (the Messaging trigger adds last_whatsapp_reply_customer once per run of
-- customer messages, so the first flip after the agent's last message is the
-- start of the unanswered run). With no agent message at all the first
-- unanswered message is the ticket itself, which the API handles via
-- zendesk_created_at, so this column is only meaningful once an agent has
-- written.

alter table public.zendesk_tickets
  add column if not exists customer_waiting_since timestamptz;

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
    first_agent_message_at = tallies.first_agent,
    last_agent_message_at = tallies.last_agent,
    last_customer_message_at = tallies.last_customer,
    customer_waiting_since = waits.since
  from tallies
  left join waits on waits.id = tallies.id
  where t.id = tallies.id
    and (
      t.first_agent_message_at is distinct from tallies.first_agent
      or t.last_agent_message_at is distinct from tallies.last_agent
      or t.last_customer_message_at is distinct from tallies.last_customer
      or t.customer_waiting_since is distinct from waits.since
    );

  get diagnostics touched = row_count;
  return touched;
end;
$$;

-- Backfill every ticket that already has flips stored.
select public.recompute_whatsapp_activity(
  array(select distinct ticket_id from public.zendesk_whatsapp_messages)
);
