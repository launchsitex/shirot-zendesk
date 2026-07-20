create or replace function private.guard_aircall_agent_status_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  latest_user_data jsonb;
  agent_data jsonb;
  wrap_up_time integer;
begin
  if new.raw ->> 'provider' is distinct from 'aircall' then
    return new;
  end if;

  if new.zendesk_agent_state = 'call.ended' and tg_op = 'UPDATE' then
    return old;
  end if;

  if new.zendesk_agent_state = 'call.hungup' then
    select event.payload -> 'data'
    into latest_user_data
    from public.aircall_webhook_events as event
    where event.event_type like 'user.%'
      and event.payload -> 'data' ->> 'id' = new.agent_id
      and event.processed = true
    order by event.received_at desc
    limit 1;

    select raw into agent_data
    from public.agents
    where id = new.agent_id;

    wrap_up_time := coalesce(
      (agent_data ->> 'wrap_up_time')::integer,
      0
    );

    if wrap_up_time > 0 and tg_op = 'UPDATE' then
      return old;
    end if;

    new.state := private.aircall_state_from_user(
      coalesce(latest_user_data, agent_data, '{}'::jsonb)
    );
    new.zendesk_agent_state := coalesce(
      latest_user_data ->> 'substatus',
      agent_data ->> 'substatus',
      new.zendesk_agent_state
    );
  end if;

  return new;
end;
$$;

drop trigger if exists guard_aircall_agent_status_order
  on public.agent_live_status;
create trigger guard_aircall_agent_status_order
before insert or update on public.agent_live_status
for each row execute function private.guard_aircall_agent_status_order();

update public.agent_live_status as live
set
  state = private.aircall_state_from_user(agent.raw),
  zendesk_agent_state = coalesce(
    agent.raw ->> 'substatus',
    agent.raw ->> 'availability_status'
  ),
  state_since = now(),
  current_call_started_at = null,
  raw = jsonb_build_object(
    'provider', 'aircall',
    'source', 'stale_call_status_repair',
    'substatus', agent.raw ->> 'substatus'
  ),
  updated_at = now()
from public.agents as agent
where agent.id = live.agent_id
  and live.state = 'wrap_up'
  and not exists (
    select 1
    from public.calls as call
    where call.agent_id = live.agent_id
      and call.status = 'in_progress'
  );

revoke all on function private.guard_aircall_agent_status_order()
  from public, anon, authenticated;
