create or replace function private.apply_aircall_user_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  user_data jsonb;
  v_agent_id text;
  next_state public.agent_state;
begin
  if new.processed is not true
    or new.event_type not like 'user.%'
  then
    return new;
  end if;

  user_data := new.payload -> 'data';
  v_agent_id := user_data ->> 'id';
  if v_agent_id is null then
    return new;
  end if;

  next_state := case
    when replace(new.event_type, '.v2', '') = 'user.wut_start'
      then 'wrap_up'::public.agent_state
    when replace(new.event_type, '.v2', '') = 'user.deleted'
      then 'unavailable'::public.agent_state
    when replace(new.event_type, '.v2', '') = 'user.disconnected'
      and nullif(trim(user_data ->> 'substatus'), '') is null
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
    v_agent_id,
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

revoke all on function private.apply_aircall_user_status()
  from public, anon, authenticated;
