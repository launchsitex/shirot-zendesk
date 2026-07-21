-- Close phantom in_progress calls that keep agents stuck as "בשיחה"
-- after external transfer or when Aircall already shows Away presence.

create or replace function private.close_agent_open_calls(
  p_agent_id text,
  p_reason text default 'closed_by_presence'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_count integer;
begin
  with closed as (
    update public.calls c
    set
      status = (
        case
          when coalesce(c.talk_time_seconds, 0) > 0 then 'answered'
          when coalesce(c.raw->>'answered_at', '') <> '' then 'answered'
          else 'missed'
        end
      )::public.call_status,
      ended_at = coalesce(c.ended_at, c.source_updated_at, now()),
      completion_status = p_reason,
      raw = coalesce(c.raw, '{}'::jsonb)
        || jsonb_build_object(
          'closed_reason', p_reason,
          'closed_at', now()
        ),
      source_updated_at = now(),
      synced_at = now()
    where c.agent_id = p_agent_id
      and c.status = 'in_progress'
    returning c.id
  )
  select count(*)::integer into updated_count from closed;
  return coalesce(updated_count, 0);
end;
$$;

revoke all on function private.close_agent_open_calls(text, text) from public;
grant execute on function private.close_agent_open_calls(text, text) to service_role;

-- Only promote free/available agents to on_call from fresh open calls.
-- Never overwrite Back office / break / lunch / etc.
create or replace function private.reconcile_agent_on_call_from_active_calls()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_count integer;
begin
  with active as (
    select agent_id, min(started_at) as call_started_at
    from public.calls
    where status = 'in_progress'
      and agent_id is not null
      and coalesce(source_updated_at, started_at) > now() - interval '30 minutes'
      and coalesce(raw->>'last_event', '') <> 'call.external_transferred'
    group by agent_id
  ),
  updated as (
    update public.agent_live_status s
    set
      state = 'on_call',
      state_since = coalesce(a.call_started_at, s.state_since),
      current_call_started_at = coalesce(
        a.call_started_at,
        s.current_call_started_at,
        now()
      ),
      zendesk_call_status = 'reconciled_from_active_call',
      updated_at = now()
    from active a
    where s.agent_id = a.agent_id
      and s.state in ('available', 'scheduled')
      and s.state is distinct from 'on_call'
    returning s.agent_id
  )
  select count(*)::integer into updated_count from updated;
  return coalesce(updated_count, 0);
end;
$$;

revoke all on function private.reconcile_agent_on_call_from_active_calls() from public;
grant execute on function private.reconcile_agent_on_call_from_active_calls() to service_role;

-- One-shot cleanup for currently stuck rows.
update public.calls c
set
  status = (
    case
      when coalesce(c.talk_time_seconds, 0) > 0 then 'answered'
      when coalesce(c.raw->>'answered_at', '') <> '' then 'answered'
      else 'missed'
    end
  )::public.call_status,
  ended_at = coalesce(c.ended_at, c.source_updated_at, now()),
  completion_status = 'stale_external_transfer',
  raw = coalesce(c.raw, '{}'::jsonb)
    || jsonb_build_object(
      'closed_reason', 'stale_external_transfer',
      'closed_at', now()
    ),
  source_updated_at = now(),
  synced_at = now()
where c.status = 'in_progress'
  and coalesce(c.raw->>'last_event', '') = 'call.external_transferred';

update public.calls c
set
  status = (
    case
      when coalesce(c.talk_time_seconds, 0) > 0 then 'answered'
      when coalesce(c.raw->>'answered_at', '') <> '' then 'answered'
      else 'missed'
    end
  )::public.call_status,
  ended_at = coalesce(c.ended_at, c.source_updated_at, now()),
  completion_status = 'closed_by_away_presence',
  raw = coalesce(c.raw, '{}'::jsonb)
    || jsonb_build_object(
      'closed_reason', 'closed_by_away_presence',
      'closed_at', now()
    ),
  source_updated_at = now(),
  synced_at = now()
from public.agent_live_status s
where c.agent_id = s.agent_id
  and c.status = 'in_progress'
  and s.state in (
    'back_office',
    'on_break',
    'out_for_lunch',
    'in_training',
    'other',
    'unavailable',
    'scheduled'
  );
