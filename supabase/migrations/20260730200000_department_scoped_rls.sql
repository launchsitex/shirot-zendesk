-- Applied to the live Supabase project on 2026-07-30 via MCP apply_migration.
-- Closes the known security gap: calls / call_recordings / call_legs / agents /
-- agent_live_status / agent_status_history were readable by ANY authenticated
-- user (`using (true)`), so department isolation existed only in the Next.js
-- API and could be bypassed by querying PostgREST directly from the browser.
--
-- The new policies mirror src/lib/auth/department-scope.ts exactly:
--   admin OR profile has no department  -> full read (unchanged behavior)
--   profile scoped to a department      -> rows of that department only
--
-- Notes:
-- * `list_call_recordings_page` is SECURITY INVOKER, so it inherits these
--   policies automatically; Realtime subscriptions are filtered the same way.
-- * Edge Functions use service_role and are unaffected.
-- * queue_snapshots / zendesk_customers still allow broad reads and hold
--   caller numbers too — candidates for a follow-up pass.

-- Helper: the calling user's department (NULL = unscoped/full view).
-- SECURITY DEFINER so it can read profiles without recursing into its RLS;
-- STABLE so planners evaluate it once per query when wrapped in (select ...).
create or replace function private.current_department_id()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select department_id from public.profiles where id = auth.uid()
$$;

revoke all on function private.current_department_id() from public;
grant execute on function private.current_department_id() to authenticated;

-- calls: direct department column.
drop policy if exists "authenticated read calls" on public.calls;
create policy "department scoped read calls" on public.calls
for select to authenticated
using (
  (select public.is_admin())
  or (select private.current_department_id()) is null
  or department_id = (select private.current_department_id())
);

-- agents: direct department column.
drop policy if exists "authenticated read agents" on public.agents;
create policy "department scoped read agents" on public.agents
for select to authenticated
using (
  (select public.is_admin())
  or (select private.current_department_id()) is null
  or department_id = (select private.current_department_id())
);

-- call_recordings / call_legs: visible iff the parent call is visible
-- (delegates to the calls policy above via invoker RLS on the subquery).
drop policy if exists "authenticated read call recordings" on public.call_recordings;
create policy "department scoped read call recordings" on public.call_recordings
for select to authenticated
using (
  exists (select 1 from public.calls c where c.id = call_recordings.call_id)
);

drop policy if exists "authenticated read call legs" on public.call_legs;
create policy "department scoped read call legs" on public.call_legs
for select to authenticated
using (
  exists (select 1 from public.calls c where c.id = call_legs.call_id)
);

-- agent_live_status / agent_status_history: visible iff the agent is visible.
drop policy if exists "authenticated read live status" on public.agent_live_status;
create policy "department scoped read live status" on public.agent_live_status
for select to authenticated
using (
  exists (select 1 from public.agents a where a.id = agent_live_status.agent_id)
);

drop policy if exists "authenticated read agent status history" on public.agent_status_history;
create policy "department scoped read agent status history" on public.agent_status_history
for select to authenticated
using (
  exists (select 1 from public.agents a where a.id = agent_status_history.agent_id)
);
