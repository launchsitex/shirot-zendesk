-- Applied to the live project on 2026-08-09.
--
-- The "פניות פתוחות" page narrows to tickets the agent finished and never
-- wrote in, excluding WhatsApp.
--
-- via_channel is promoted out of raw into its own indexed column. Probing
-- raw->'via'->>'channel' on every request means reading the whole JSONB blob
-- per row with no index to help, on a table that grows by ~1,300 rows a day —
-- and the database is already under CPU pressure.

alter table public.zendesk_tickets
  add column if not exists via_channel text;

update public.zendesk_tickets
set via_channel = raw->'via'->>'channel'
where via_channel is null
  and raw->'via'->>'channel' is not null;

create index if not exists zendesk_tickets_channel_status_idx
  on public.zendesk_tickets (via_channel, status, zendesk_created_at desc);

-- Per-agent counts for that page.
--
-- "Closed" here is solved OR closed. The team's Zendesk shows four statuses —
-- פתוחה / תזכורת / בהמתנה / פתורה — and "פתורה" is `solved`: what an agent sets
-- when they are done. `closed` is the same ticket after Zendesk archives it
-- automatically days later, and is not offered in their UI at all. Counting
-- only `solved` would make an undocumented ticket quietly vanish from a past
-- day once it aged into `closed`.
create or replace function public.zendesk_undocumented_summary(
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  agent_id text,
  agent_name text,
  department_name text,
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
    count(*) as undocumented_count
  from public.zendesk_tickets t
  left join public.agents a on a.id = t.agent_id
  left join public.departments d on d.id = a.department_id
  where t.zendesk_created_at >= p_from
    and t.zendesk_created_at <= p_to
    and not t.documented
    and t.status in ('solved', 'closed')
    -- WhatsApp conversations are opened by the customer's own message rather
    -- than by an agent handling a call, so they are not part of this measure.
    and coalesce(t.via_channel, '') <> 'whatsapp'
  group by 1, 2, 3
  order by count(*) desc, 2;
$$;

grant execute on function public.zendesk_undocumented_summary(timestamptz, timestamptz)
  to authenticated, service_role;
