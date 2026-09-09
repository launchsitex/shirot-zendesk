-- WhatsApp conversations on this account run on Zendesk Messaging, and the
-- messages themselves are NOT written to the ticket as they happen: the whole
-- chat lands as a single `chat_transcript` comment (author -1) only once the
-- session goes inactive. So the comment stream tells us nothing about who
-- wrote last, or when, while a conversation is live — which is exactly when
-- the WhatsApp dashboards need it.
--
-- What does move per message is a pair of tags flipped by a Messaging
-- trigger ("Messaging-Trigger-Service") on every message:
--   last_whatsapp_reply_agent     — an agent (a person, not the bot) wrote
--   last_whatsapp_reply_customer  — the customer wrote
-- Verified on live audits (2026-09-09): a 20-exchange conversation shows 20
-- flips at human pacing, and a ticket the bot handled alone shows no flip
-- until a person replied. Those flips are the message timeline, so the sync
-- now stores each one, and three derived timestamps drive the dashboards:
-- first/last agent message, last customer message.
--
-- first_agent_comment_at (assignee's first *internal note*, via the Aircall
-- app) stays for the documentation-tracking page; it is not a customer-facing
-- reply and the WhatsApp pages stop using it as one.

create table if not exists public.zendesk_whatsapp_messages (
  -- The tag-change child event's id from Zendesk's incremental export, so a
  -- replayed page upserts instead of double-counting.
  id text primary key,
  ticket_id text not null,
  direction text not null check (direction in ('agent', 'customer')),
  at timestamptz not null
);

create index if not exists zendesk_whatsapp_messages_ticket_idx
  on public.zendesk_whatsapp_messages (ticket_id, at);

alter table public.zendesk_whatsapp_messages enable row level security;

-- Read follows the parent ticket's visibility, same as the comments table.
drop policy if exists "read zendesk whatsapp messages" on public.zendesk_whatsapp_messages;
create policy "read zendesk whatsapp messages"
  on public.zendesk_whatsapp_messages
  for select to authenticated
  using (
    exists (
      select 1 from public.zendesk_tickets t
      where t.id = zendesk_whatsapp_messages.ticket_id
    )
  );

alter table public.zendesk_tickets
  add column if not exists first_agent_message_at timestamptz;
alter table public.zendesk_tickets
  add column if not exists last_agent_message_at timestamptz;
alter table public.zendesk_tickets
  add column if not exists last_customer_message_at timestamptz;

-- Recomputes the three timestamps for the given tickets from stored flips.
-- Same shape and safety model as recompute_ticket_documentation: service role
-- only, idempotent, touches a row only when a value actually changes.
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
  )
  update public.zendesk_tickets t
  set
    first_agent_message_at = tallies.first_agent,
    last_agent_message_at = tallies.last_agent,
    last_customer_message_at = tallies.last_customer
  from tallies
  where t.id = tallies.id
    and (
      t.first_agent_message_at is distinct from tallies.first_agent
      or t.last_agent_message_at is distinct from tallies.last_agent
      or t.last_customer_message_at is distinct from tallies.last_customer
    );

  get diagnostics touched = row_count;
  return touched;
end;
$$;

revoke all on function public.recompute_whatsapp_activity(text[]) from public;
grant execute on function public.recompute_whatsapp_activity(text[]) to service_role;
