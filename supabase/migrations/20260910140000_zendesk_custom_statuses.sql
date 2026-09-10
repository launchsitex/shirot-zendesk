-- Zendesk custom statuses ("תזכורת", "תאום לקוח" etc.) all share the base
-- status_category "open" — the ticket's own `status` field cannot tell them
-- apart from a plain open ticket. The account owner's rule (2026-09-10,
-- ticket #69875): only the *default* open custom status ("פתוחה") counts as
-- the customer waiting for a reply on the WhatsApp dashboards; every other
-- open sub-status means the agent already triaged it and parked it for a
-- reason of their own (a reminder, a coordination step) — not a customer
-- still waiting. Synced alongside agent availability so it stays current as
-- statuses are added or renamed in Zendesk.
create table if not exists public.zendesk_custom_statuses (
  id text primary key,
  status_category text not null,
  agent_label text not null,
  is_default boolean not null default false,
  active boolean not null default true,
  synced_at timestamptz not null default now()
);

alter table public.zendesk_custom_statuses enable row level security;

drop policy if exists "authenticated read custom statuses" on public.zendesk_custom_statuses;
create policy "authenticated read custom statuses"
  on public.zendesk_custom_statuses
  for select to authenticated
  using (true);

alter table public.zendesk_tickets
  add column if not exists custom_status_id text;
