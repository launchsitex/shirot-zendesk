-- The previous two migrations added reconciliation functions
-- (close_agent_open_calls, reconcile_agent_on_call_from_active_calls) but only
-- ran them once, at migration-apply time. Nothing invokes them since. If a
-- single hangup webhook is ever dropped (network blip, cold start, race) and
-- the agent never explicitly moves to an Away status afterwards, the phantom
-- in_progress call row has no self-healing path and can persist indefinitely,
-- showing a ghost "active call" that never clears from the dashboard/wallboard.
--
-- This adds a periodic sweep so both functions actually run on a schedule.

create or replace function private.sweep_stale_open_calls(
  p_stale_after interval default interval '30 minutes'
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
      completion_status = 'closed_by_stale_sweep',
      raw = coalesce(c.raw, '{}'::jsonb)
        || jsonb_build_object(
          'closed_reason', 'closed_by_stale_sweep',
          'closed_at', now()
        ),
      source_updated_at = now(),
      synced_at = now()
    where c.status = 'in_progress'
      and coalesce(c.source_updated_at, c.started_at) < now() - p_stale_after
    returning c.id
  )
  select count(*)::integer into updated_count from closed;
  return coalesce(updated_count, 0);
end;
$$;

revoke all on function private.sweep_stale_open_calls(interval) from public;
grant execute on function private.sweep_stale_open_calls(interval) to service_role;

do $$
begin
  if exists (
    select 1 from cron.job where jobname = 'agent-status-reconcile-every-2-minutes'
  ) then
    perform cron.unschedule('agent-status-reconcile-every-2-minutes');
  end if;
  perform cron.schedule(
    'agent-status-reconcile-every-2-minutes',
    '*/2 * * * *',
    $cron$
      select private.sweep_stale_open_calls();
      select private.reconcile_agent_on_call_from_active_calls();
    $cron$
  );
end;
$$;
