-- Live agent availability from Zendesk's Agent Availability API (omnichannel
-- routing): the agent's status — online / away / transfers_only / offline,
-- or a custom status the account defined, e.g. "הפסקה" — and the messaging
-- channel's load against its capacity (work_item_count / max_capacity, 7 on
-- this account). Refreshed by the ticket sync every minute; one row per
-- Zendesk agent, so the table is tiny and RLS can simply follow the roster.

create table if not exists public.zendesk_agent_availability (
  zendesk_agent_id text primary key,
  -- Our roster id, matched by email; null for a Zendesk agent we don't track.
  agent_id text references public.agents(id) on delete set null,
  status_name text not null,
  status_reason text,
  status_updated_at timestamptz,
  messaging_status text,
  messaging_work_items integer not null default 0,
  messaging_max_capacity integer,
  group_ids text[] not null default '{}',
  synced_at timestamptz not null default now()
);

create index if not exists zendesk_agent_availability_agent_idx
  on public.zendesk_agent_availability (agent_id);

alter table public.zendesk_agent_availability enable row level security;

-- Same department scoping as the roster: a scoped viewer sees their own
-- department's agents; unscoped viewers and admins see everyone.
drop policy if exists "department scoped read agent availability" on public.zendesk_agent_availability;
create policy "department scoped read agent availability"
  on public.zendesk_agent_availability
  for select to authenticated
  using (
    (select public.is_admin())
    or (select private.current_department_id()) is null
    or exists (
      select 1 from public.agents a
      where a.id = zendesk_agent_availability.agent_id
        and a.department_id = (select private.current_department_id())
    )
  );
