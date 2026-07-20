alter table public.calls
  add column if not exists transferred_by_agent_id text references public.agents(id) on delete set null;

create index if not exists calls_transferred_by_agent_started_idx
  on public.calls (transferred_by_agent_id, started_at desc);

comment on column public.calls.transferred_by_agent_id is
  'Aircall agent who transferred this call (from transferred_by).';

-- Backfill from call raw payloads that still include transferred_by.
update public.calls
set transferred_by_agent_id = raw -> 'transferred_by' ->> 'id'
where transferred_by_agent_id is null
  and raw -> 'transferred_by' ->> 'id' is not null
  and exists (
    select 1 from public.agents a where a.id = raw -> 'transferred_by' ->> 'id'
  );

-- Backfill from transfer webhook events when later call.ended wiped transferred_by.
with latest_transfers as (
  select distinct on ((payload -> 'data' ->> 'id'))
    payload -> 'data' ->> 'id' as call_id,
    coalesce(
      payload -> 'data' -> 'transferred_by' ->> 'id',
      payload -> 'data' -> 'user' ->> 'id'
    ) as agent_id
  from public.aircall_webhook_events
  where event_type in ('call.transferred', 'call.external_transferred')
    and payload -> 'data' ->> 'id' is not null
  order by
    (payload -> 'data' ->> 'id'),
    received_at desc
)
update public.calls as call
set transferred_by_agent_id = latest_transfers.agent_id
from latest_transfers
where call.id = latest_transfers.call_id
  and call.transferred_by_agent_id is null
  and latest_transfers.agent_id is not null
  and exists (
    select 1 from public.agents a where a.id = latest_transfers.agent_id
  );
