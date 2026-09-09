-- Two things the WhatsApp dashboards approximated, now measured exactly, at
-- the account owner's request because agent pay and bonuses follow them:
--
--   1. Time to close ran to the ticket's last update, which any later edit
--      moved. It now runs to the moment the ticket was set to solved.
--   2. Everything was credited to whoever is assigned *now*. First response
--      and closure are now credited to the agent who was assigned at that
--      moment, so a ticket that changed hands credits each agent for their
--      own part.
--
-- Both need the status and assignee changes as events. Zendesk's incremental
-- ticket_events export already carries them (Change children with `status` /
-- `assignee_id` and `previous_value`); the sync stores them here.

create table if not exists public.zendesk_ticket_transitions (
  id text primary key,
  ticket_id text not null,
  at timestamptz not null,
  kind text not null check (kind in ('status', 'assignee')),
  -- The new status, or the new assignee's Zendesk user id ('' when cleared).
  value text not null
);

create index if not exists zendesk_ticket_transitions_ticket_idx
  on public.zendesk_ticket_transitions (ticket_id, at);

alter table public.zendesk_ticket_transitions enable row level security;

drop policy if exists "read zendesk ticket transitions" on public.zendesk_ticket_transitions;
create policy "read zendesk ticket transitions"
  on public.zendesk_ticket_transitions
  for select to authenticated
  using (
    exists (
      select 1 from public.zendesk_tickets t
      where t.id = zendesk_ticket_transitions.ticket_id
    )
  );

alter table public.zendesk_tickets
  add column if not exists solved_at timestamptz;
alter table public.zendesk_tickets
  add column if not exists first_response_agent_id text references public.agents(id) on delete set null;
alter table public.zendesk_tickets
  add column if not exists solved_by_agent_id text references public.agents(id) on delete set null;

-- Zendesk user id -> our agent id, from every ticket we have seen assigned to
-- them. Assignee ids in transition events are Zendesk ids; the roster is
-- keyed by ours.
create or replace function public.agent_for_zendesk_user(p_zendesk_user_id text)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select z.agent_id
  from public.zendesk_tickets z
  where z.assignee_id = p_zendesk_user_id and z.agent_id is not null
  limit 1;
$$;

revoke all on function public.agent_for_zendesk_user(text) from public;
grant execute on function public.agent_for_zendesk_user(text) to service_role;

-- Derives solved_at and the credited agents from stored transitions. The
-- agent "at" a moment is the last assignee transition on or before it; with
-- no transition recorded before that moment, the ticket's current assignee
-- is the best available answer.
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
      ) as solved_by_agent_id
    from public.zendesk_tickets t
    left join solved s on s.ticket_id = t.id
    where t.id = any (p_ticket_ids)
  )
  update public.zendesk_tickets t
  set
    solved_at = c.solved_at,
    first_response_agent_id = c.first_response_agent_id,
    solved_by_agent_id = c.solved_by_agent_id
  from computed c
  where t.id = c.id
    and (
      t.solved_at is distinct from c.solved_at
      or t.first_response_agent_id is distinct from c.first_response_agent_id
      or t.solved_by_agent_id is distinct from c.solved_by_agent_id
    );

  get diagnostics touched = row_count;
  return touched;
end;
$$;

revoke all on function public.recompute_ticket_transitions(text[]) from public;
grant execute on function public.recompute_ticket_transitions(text[]) to service_role;
