-- Applied to the live project on 2026-08-06.
--
-- "מעקב פניות": Zendesk tickets alongside the call data.
--
-- Purely additive — no existing table, policy or function is touched. The
-- Zendesk integration had been retired (src/app/api/settings/zendesk returns
-- 410), so this is a fresh connection using the Edge Function secrets
-- mail_Zendesk / API_Zendesk against the rcity subdomain. Connectivity was
-- verified first: authenticates as an admin, 27,091 tickets in the account.
--
-- agent_id links a ticket to the call centre agent who owns it. Zendesk
-- assignees match our agents exactly: all 29 sampled matched on both email and
-- name, and every active agent has an email. Email is the join key because a
-- display name can be edited in either system independently.

create table if not exists public.zendesk_tickets (
  id text primary key,
  subject text,
  status text not null,
  priority text,
  -- The customer who opened the ticket.
  requester_id text,
  requester_name text,
  requester_phone text,
  -- The Zendesk-side assignee, kept verbatim so a ticket assigned to somebody
  -- who is not a call centre agent (or nobody at all) still displays.
  assignee_id text,
  assignee_email text,
  assignee_name text,
  -- Resolved link to our roster; null when the assignee has no matching agent.
  agent_id text references public.agents(id) on delete set null,
  group_id text,
  zendesk_created_at timestamptz not null,
  zendesk_updated_at timestamptz not null,
  raw jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now()
);

create index if not exists zendesk_tickets_created_idx
  on public.zendesk_tickets (zendesk_created_at desc);
create index if not exists zendesk_tickets_agent_idx
  on public.zendesk_tickets (agent_id, zendesk_created_at desc);
create index if not exists zendesk_tickets_status_idx
  on public.zendesk_tickets (status);

alter table public.zendesk_tickets enable row level security;

-- Same department scoping as calls and agents: a scoped viewer sees only the
-- tickets of agents in their own department. Tickets with no matching agent
-- have no department, so only unscoped viewers (admins) see them.
drop policy if exists "department scoped read zendesk tickets" on public.zendesk_tickets;
create policy "department scoped read zendesk tickets"
  on public.zendesk_tickets
  for select to authenticated
  using (
    (select public.is_admin())
    or (select private.current_department_id()) is null
    or exists (
      select 1 from public.agents a
      where a.id = zendesk_tickets.agent_id
        and a.department_id = (select private.current_department_id())
    )
  );

-- Cursor for Zendesk's incremental export. Keeping it in a row rather than
-- deriving it from max(updated_at) means a failed run cannot silently skip
-- tickets that changed while it was down.
create table if not exists public.zendesk_sync_state (
  id integer primary key default 1 check (id = 1),
  last_start_time bigint,
  last_run_at timestamptz,
  last_result jsonb
);

insert into public.zendesk_sync_state (id) values (1) on conflict (id) do nothing;

alter table public.zendesk_sync_state enable row level security;

drop policy if exists "admins read zendesk sync state" on public.zendesk_sync_state;
create policy "admins read zendesk sync state"
  on public.zendesk_sync_state
  for select to authenticated
  using ((select public.is_admin()));
