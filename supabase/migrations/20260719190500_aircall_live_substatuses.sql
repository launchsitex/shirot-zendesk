create or replace function private.aircall_state_from_user(user_data jsonb)
returns public.agent_state
language sql
immutable
set search_path = ''
as $$
  select case lower(coalesce(user_data ->> 'substatus', ''))
    when 'always_opened' then 'available'::public.agent_state
    when 'available' then 'available'::public.agent_state
    when 'according_to_schedule' then 'scheduled'::public.agent_state
    when 'scheduled' then 'scheduled'::public.agent_state
    when 'out_for_lunch' then 'out_for_lunch'::public.agent_state
    when 'lunch' then 'out_for_lunch'::public.agent_state
    when 'on_break' then 'on_break'::public.agent_state
    when 'break' then 'on_break'::public.agent_state
    when 'in_training' then 'in_training'::public.agent_state
    when 'training' then 'in_training'::public.agent_state
    when 'doing_back_office' then 'back_office'::public.agent_state
    when 'back_office' then 'back_office'::public.agent_state
    when 'other' then 'other'::public.agent_state
    when 'always_closed' then 'unavailable'::public.agent_state
    else case lower(coalesce(
      user_data ->> 'availability_status',
      user_data ->> 'available',
      ''
    ))
      when 'available' then 'available'::public.agent_state
      when 'true' then 'available'::public.agent_state
      else 'unavailable'::public.agent_state
    end
  end;
$$;

create or replace function private.apply_aircall_user_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  user_data jsonb;
  agent_id text;
  next_state public.agent_state;
begin
  if new.processed is not true
    or new.event_type not like 'user.%'
  then
    return new;
  end if;

  user_data := new.payload -> 'data';
  agent_id := user_data ->> 'id';
  if agent_id is null then
    return new;
  end if;

  next_state := case
    when replace(new.event_type, '.v2', '') = 'user.wut_start'
      then 'wrap_up'::public.agent_state
    when replace(new.event_type, '.v2', '') in (
      'user.disconnected',
      'user.deleted'
    )
      then 'unavailable'::public.agent_state
    else private.aircall_state_from_user(user_data)
  end;

  insert into public.agent_live_status (
    agent_id,
    state,
    zendesk_agent_state,
    zendesk_call_status,
    state_since,
    current_call_started_at,
    raw,
    updated_at
  )
  values (
    agent_id,
    next_state,
    coalesce(user_data ->> 'substatus', new.event_type),
    new.event_type,
    now(),
    null,
    jsonb_build_object(
      'provider', 'aircall',
      'event', new.event_type,
      'substatus', user_data ->> 'substatus'
    ),
    now()
  )
  on conflict (agent_id) do update set
    state = excluded.state,
    zendesk_agent_state = excluded.zendesk_agent_state,
    zendesk_call_status = excluded.zendesk_call_status,
    state_since = case
      when public.agent_live_status.state = excluded.state
        then public.agent_live_status.state_since
      else excluded.state_since
    end,
    current_call_started_at = null,
    raw = excluded.raw,
    updated_at = excluded.updated_at;

  return new;
end;
$$;

drop trigger if exists aircall_user_status_after_processing
  on public.aircall_webhook_events;
create trigger aircall_user_status_after_processing
after update of processed on public.aircall_webhook_events
for each row execute function private.apply_aircall_user_status();

with latest_agent_department as (
  select distinct on (call.agent_id)
    call.agent_id,
    call.department_id
  from public.calls as call
  where call.agent_id is not null
    and call.department_id is not null
  order by call.agent_id, call.started_at desc
)
update public.agents as agent
set department_id = latest.department_id
from latest_agent_department as latest
where agent.id = latest.agent_id
  and agent.department_id is null;

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
    'substatus', agent.raw ->> 'substatus'
  ),
  updated_at = now()
from public.agents as agent
where agent.id = live.agent_id
  and agent.raw ->> 'provider' = 'aircall'
  and live.state not in ('ringing', 'on_call');

revoke all on function private.aircall_state_from_user(jsonb)
  from public, anon, authenticated;
revoke all on function private.apply_aircall_user_status()
  from public, anon, authenticated;
