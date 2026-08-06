-- Applied to the live project on 2026-08-06 (as three statements-groups; kept
-- together here because they are one change).
--
-- Tracks whether the assigned agent actually wrote anything on a ticket.
--
-- Why not Zendesk's built-in `replies` metric: it counts *public* agent
-- replies, and this team writes internal notes ("הוסף הערה") through the
-- Aircall app inside Zendesk. Sampled over six hours, `replies` was 0 on
-- essentially every ticket, so it would have marked the whole call centre as
-- undocumented.
--
-- What actually writes on a ticket here, measured over two hours: Aircall Bot
-- (automatic call summaries, 150 comments), the Zendesk system (triggers, 102),
-- the customer over WhatsApp, and real agents (~37). Documentation is a comment
-- whose author is the ticket's own assignee — comparing author_id to
-- assignee_id needs no role lookup at all.
--
-- Notes and public replies are counted separately: the ask was about "הוסף
-- הערה", but an agent who answered the customer at length has plainly handled
-- the ticket, so both count as documented while staying visible apart.

alter table public.zendesk_tickets
  add column if not exists agent_note_count integer not null default 0;

alter table public.zendesk_tickets
  add column if not exists agent_reply_count integer not null default 0;

alter table public.zendesk_tickets
  add column if not exists last_agent_comment_at timestamptz;

-- Generated so it can never drift from the counts that feed it.
alter table public.zendesk_tickets
  drop column if exists documented;

alter table public.zendesk_tickets
  add column documented boolean
  generated always as ((agent_note_count + agent_reply_count) > 0) stored;

create index if not exists zendesk_tickets_documented_idx
  on public.zendesk_tickets (documented, zendesk_created_at desc);

-- Comment events are exported on their own incremental stream, so they need
-- their own cursor rather than sharing the ticket one.
alter table public.zendesk_sync_state
  add column if not exists last_events_start_time bigint;

alter table public.zendesk_sync_state
  add column if not exists last_events_result jsonb;

-- Comment events are stored rather than counted on the fly.
--
-- Incrementing a counter as events stream in is not safe: Zendesk's incremental
-- export can hand back the same event across a cursor boundary, and any
-- backfill or replay would inflate every count with no way to tell. Keyed on
-- the event id, an upsert is idempotent, and the counts are recomputed from
-- what is actually stored.
--
-- Bodies are deliberately not stored. The question is only who wrote and when;
-- keeping the customer conversation would be a copy of the ticket contents with
-- nothing to gain.
create table if not exists public.zendesk_ticket_comments (
  id text primary key,
  ticket_id text not null,
  author_id text,
  is_public boolean not null default false,
  created_at timestamptz not null
);

create index if not exists zendesk_ticket_comments_ticket_idx
  on public.zendesk_ticket_comments (ticket_id);

alter table public.zendesk_ticket_comments enable row level security;

-- Read follows the parent ticket's visibility.
drop policy if exists "read zendesk ticket comments" on public.zendesk_ticket_comments;
create policy "read zendesk ticket comments"
  on public.zendesk_ticket_comments
  for select to authenticated
  using (
    exists (
      select 1 from public.zendesk_tickets t
      where t.id = zendesk_ticket_comments.ticket_id
    )
  );

-- Recomputes documentation counters for the given tickets from stored events.
-- A comment counts only when its author is the ticket's own assignee, which is
-- what "the agent documented it" means; notes and public replies stay separate.
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
      ) as last_at
    from public.zendesk_tickets t
    left join public.zendesk_ticket_comments c on c.ticket_id = t.id
    where t.id = any (p_ticket_ids)
    group by t.id
  )
  update public.zendesk_tickets t
  set
    agent_note_count = tallies.notes,
    agent_reply_count = tallies.replies,
    last_agent_comment_at = tallies.last_at
  from tallies
  where t.id = tallies.id
    and (
      t.agent_note_count is distinct from tallies.notes
      or t.agent_reply_count is distinct from tallies.replies
      or t.last_agent_comment_at is distinct from tallies.last_at
    );

  get diagnostics touched = row_count;
  return touched;
end;
$$;

revoke all on function public.recompute_ticket_documentation(text[]) from public;
grant execute on function public.recompute_ticket_documentation(text[]) to service_role;

-- Documented/undocumented counts join the per-agent summary so the page can
-- show who writes their notes and who does not without shipping every row.
--
-- DROP then CREATE because Postgres will not change a function's return type in
-- place. Both run in one migration, so the function is never missing for
-- another session, and the argument list is unchanged so callers are untouched.
drop function if exists public.zendesk_ticket_summary(timestamptz, timestamptz);

create function public.zendesk_ticket_summary(
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  agent_id text,
  agent_name text,
  department_name text,
  open_count bigint,
  closed_count bigint,
  total_count bigint,
  documented_count bigint,
  undocumented_count bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    t.agent_id,
    coalesce(a.name, t.assignee_name, 'ללא שיוך נציג') as agent_name,
    d.name as department_name,
    count(*) filter (where t.status not in ('solved', 'closed')) as open_count,
    count(*) filter (where t.status in ('solved', 'closed')) as closed_count,
    count(*) as total_count,
    count(*) filter (where t.documented) as documented_count,
    count(*) filter (where not t.documented) as undocumented_count
  from public.zendesk_tickets t
  left join public.agents a on a.id = t.agent_id
  left join public.departments d on d.id = a.department_id
  where t.zendesk_created_at >= p_from
    and t.zendesk_created_at <= p_to
  group by 1, 2, 3
  order by count(*) desc, 2;
$$;

grant execute on function public.zendesk_ticket_summary(timestamptz, timestamptz)
  to authenticated, service_role;
