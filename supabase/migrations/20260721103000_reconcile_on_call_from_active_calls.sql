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
    where status = 'in_progress' and agent_id is not null
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
      and s.state is distinct from 'on_call'
    returning s.agent_id
  )
  select count(*)::integer into updated_count from updated;
  return coalesce(updated_count, 0);
end;
$$;

revoke all on function private.reconcile_agent_on_call_from_active_calls() from public;
grant execute on function private.reconcile_agent_on_call_from_active_calls() to service_role;
