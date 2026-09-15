-- wa_department_daily_interactions was created with RLS enabled (project
-- default) but no policy, so every authenticated read returned zero rows.
-- Same department-scoped read rule as wa_agent_daily.

alter table public.wa_department_daily_interactions enable row level security;

create policy "department scoped read wa department daily interactions"
on public.wa_department_daily_interactions
for select
to authenticated
using (
  (select is_admin())
  or (select private.current_department_id()) is null
  or department_id = (select private.current_department_id())
);
