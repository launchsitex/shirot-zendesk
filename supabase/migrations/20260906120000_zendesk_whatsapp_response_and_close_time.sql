-- Redesign of "דשבורד WA" / "דשבורד TV WA": scoped to a single Israel
-- calendar day (default today) and centered on two performance figures
-- instead of a live backlog view —
--   1. first response time: from the customer's first WhatsApp message
--      (zendesk_created_at) to the assignee's first comment
--      (first_agent_comment_at, new below).
--   2. time to close: from zendesk_created_at to zendesk_updated_at, for
--      tickets that reached solved OR closed — the same "finished" definition
--      already used everywhere else in this app (see CLOSED_STATUSES in
--      src/lib/tickets.ts and the FINISHED set in /api/open-tickets). Not
--      literal `closed` alone: on this team's Zendesk, closed is an automatic
--      archival step days after an agent sets solved, not something an agent
--      chooses, so a ticket opened today will almost never reach it the same
--      day — confirmed with the account owner before building this.
--
-- first_agent_comment_at mirrors the already-existing last_agent_comment_at
-- (20260806140000_zendesk_ticket_documentation_tracking): a comment counts
-- when its author is the ticket's own assignee, which is what "the agent
-- replied" means in this codebase (this team writes through the Aircall app,
-- so Zendesk's own `replies` metric reads ~0 almost everywhere).

alter table public.zendesk_tickets
  add column if not exists first_agent_comment_at timestamptz;

-- Extends the existing recompute function (same signature and behavior for
-- every column it already touched) to also fill the new column from comment
-- events already stored in zendesk_ticket_comments.
create or replace function public.recompute_ticket_documentation(
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
      count(*) filter (
        where c.author_id = t.assignee_id and not c.is_public
      ) as notes,
      count(*) filter (
        where c.author_id = t.assignee_id and c.is_public
      ) as replies,
      max(c.created_at) filter (
        where c.author_id = t.assignee_id
      ) as last_at,
      min(c.created_at) filter (
        where c.author_id = t.assignee_id
      ) as first_at
    from public.zendesk_tickets t
    left join public.zendesk_ticket_comments c on c.ticket_id = t.id
    where t.id = any (p_ticket_ids)
    group by t.id
  )
  update public.zendesk_tickets t
  set
    agent_note_count = tallies.notes,
    agent_reply_count = tallies.replies,
    last_agent_comment_at = tallies.last_at,
    first_agent_comment_at = tallies.first_at
  from tallies
  where t.id = tallies.id
    and (
      t.agent_note_count is distinct from tallies.notes
      or t.agent_reply_count is distinct from tallies.replies
      or t.last_agent_comment_at is distinct from tallies.last_at
      or t.first_agent_comment_at is distinct from tallies.first_at
    );

  get diagnostics touched = row_count;
  return touched;
end;
$$;

-- One-time backfill so today's (and this month's) WhatsApp tickets get
-- first_agent_comment_at from comment events already synced, rather than
-- waiting for each ticket to be touched by a future sync run.
select public.recompute_ticket_documentation(
  array(select id from public.zendesk_tickets where via_channel = 'whatsapp')
);

-- The backlog-style summary functions from the previous design are no longer
-- called by anything — the redesigned /api/wa-dashboard fetches a single
-- day's rows directly (RLS applies the same as any other query) and
-- aggregates in the API route, since a single day's WhatsApp volume is far
-- below PostgREST's row cap and does not need a database-side rollup.
drop function if exists public.zendesk_whatsapp_agent_summary(integer);
drop function if exists public.zendesk_whatsapp_hourly_volume(integer);
