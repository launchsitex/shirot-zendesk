create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;

revoke all on function private.is_admin() from public, anon;
grant execute on function private.is_admin() to authenticated, service_role;

create or replace function public.is_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select private.is_admin();
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.save_zendesk_integration(text, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.save_zendesk_integration(text, text, text, boolean)
  to service_role;

do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke all on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end;
$$;

drop policy if exists "admins manage departments" on public.departments;
create policy "admins insert departments" on public.departments
for insert to authenticated with check (public.is_admin());
create policy "admins update departments" on public.departments
for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admins delete departments" on public.departments
for delete to authenticated using (public.is_admin());

drop policy if exists "admins manage department groups" on public.department_groups;
create policy "admins insert department groups" on public.department_groups
for insert to authenticated with check (public.is_admin());
create policy "admins update department groups" on public.department_groups
for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admins delete department groups" on public.department_groups
for delete to authenticated using (public.is_admin());

drop policy if exists "admins manage department lines" on public.department_lines;
create policy "admins insert department lines" on public.department_lines
for insert to authenticated with check (public.is_admin());
create policy "admins update department lines" on public.department_lines
for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admins delete department lines" on public.department_lines
for delete to authenticated using (public.is_admin());

create index agent_group_memberships_group_idx
  on public.agent_group_memberships (group_id);
create index agents_department_idx on public.agents (department_id);
create index call_legs_agent_idx on public.call_legs (agent_id);
create index calls_line_idx on public.calls (line_id);
create index department_groups_group_idx on public.department_groups (group_id);
create index department_lines_line_idx on public.department_lines (line_id);
create index integration_settings_created_by_idx
  on public.integration_settings (created_by);
create index queue_snapshots_department_idx
  on public.queue_snapshots (department_id);
