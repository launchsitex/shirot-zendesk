-- Bug-audit fixes for the SQL-trigger layer that mirrors (and can silently
-- fight with) the TypeScript aircall-webhook logic. Root cause found: three
-- independently-maintained copies of "map Aircall status -> our state"
-- (webhook mapAvailability, sync-aircall-users mapState, this SQL function)
-- had drifted apart. private.aircall_state_from_user had no case for
-- in_call/after_call_work, so it could never produce on_call/wrap_up, and
-- the trigger that calls it ran on every user.* webhook with no open-call
-- guard, unconditionally overwriting whatever the careful TS write had just
-- set moments earlier. This is the most likely explanation for the
-- recurring "shown away while actually on a call" bug class.
--
-- No data is deleted or rewritten by this migration; only function bodies
-- change (CREATE OR REPLACE), plus new indexes and RLS on one table.

create or replace function private.aircall_state_from_user(user_data jsonb)
returns public.agent_state
language sql
immutable
set search_path = ''
as $$
  select case lower(coalesce(user_data ->> 'substatus', ''))
    when 'always_open' then 'available'::public.agent_state
    when 'always_opened' then 'available'::public.agent_state
    when 'available' then 'available'::public.agent_state
    when 'according_to_schedule' then 'scheduled'::public.agent_state
    when 'scheduled' then 'scheduled'::public.agent_state
    when 'out_for_lunch' then 'out_for_lunch'::public.agent_state
    when 'lunch' then 'out_for_lunch'::public.agent_state
    when 'on_a_break' then 'on_break'::public.agent_state
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
      when 'custom' then 'scheduled'::public.agent_state
      when 'true' then 'available'::public.agent_state
      -- Previously missing: Aircall reports an agent mid-call as
      -- availability_status "in_call" / "after_call_work". Without these
      -- two cases this function could never return on_call or wrap_up,
      -- so any caller relying on it (both triggers below) defaulted a
      -- genuinely busy agent to "unavailable".
      when 'in_call' then 'on_call'::public.agent_state
      when 'after_call_work' then 'wrap_up'::public.agent_state
      else 'unavailable'::public.agent_state
    end
  end;
$$;

revoke all on function private.aircall_state_from_user(jsonb)
  from public, anon, authenticated;

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
  has_open_call boolean;
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

  -- Mirrors aircall-webhook's agentHasOpenCall guard: a plain availability
  -- ping must never overwrite a genuinely active call. Away states
  -- (including wrap_up) still win unconditionally, same as the TS layer.
  if next_state not in (
    'on_call', 'ringing', 'wrap_up',
    'back_office', 'on_break', 'out_for_lunch', 'in_training', 'other'
  ) then
    select exists (
      select 1 from public.calls
      where agent_id = v_agent_id and status = 'in_progress'
    ) into has_open_call;
    if has_open_call then
      return new;
    end if;
  end if;

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
  has_open_call boolean;
begin
  if new.raw ->> 'provider' is distinct from 'aircall' then
    return new;
  end if;

  if new.zendesk_agent_state = 'call.ended' and tg_op = 'UPDATE' then
    return old;
  end if;

  if new.zendesk_agent_state = 'call.hungup' then
    -- Multi-call agent (call-waiting / second line): this hangup only
    -- ended ONE of their calls. Reconstructing state from cached
    -- user/agent data has no notion of "which call" and previously forced
    -- a still-busy agent away from on_call. Trust the caller's own
    -- freshly-computed state instead when another call is still open.
    select exists (
      select 1 from public.calls
      where agent_id = new.agent_id and status = 'in_progress'
    ) into has_open_call;
    if has_open_call then
      return new;
    end if;

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

revoke all on function private.guard_aircall_agent_status_order()
  from public, anon, authenticated;

-- private.aircall_api_settings was the only table in the schema without RLS
-- enabled. Not reachable via PostgREST today (private schema isn't exposed),
-- but kept inconsistent with every other table otherwise.
alter table private.aircall_api_settings enable row level security;

drop policy if exists "service role manages aircall api settings"
  on private.aircall_api_settings;
create policy "service role manages aircall api settings"
  on private.aircall_api_settings
  for all to service_role
  using (true)
  with check (true);

-- Two hot-path queries run every 1-2 minutes (roster sync, stale-call sweep,
-- reconcile) or on essentially every hangup (status-order guard) with no
-- supporting index, against tables that grow without bound.
create index if not exists calls_in_progress_idx
  on public.calls (status)
  where status = 'in_progress';

create index if not exists aircall_webhook_events_user_lookup_idx
  on public.aircall_webhook_events ((payload -> 'data' ->> 'id'), received_at desc)
  where event_type like 'user.%' and processed = true;
