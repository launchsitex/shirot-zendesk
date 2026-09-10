-- A job role per agent, so "זמינות נציגות" on the WhatsApp screens can group
-- answering agents first and shift leads / coordinators / managers / people
-- who left after them (the account owner does not want managers mixed in
-- with the agents). Nothing else reads the role: tickets, waiting lists and
-- pay figures stay credited to whoever handled them, whatever their role.
--
-- A plain CHECK constraint rather than a roles table on purpose: a table
-- would be one more FK for PostgREST to trip over (see PROJECT_CONTEXT.md,
-- "PostgREST embeds"). The vocabulary lives in src/lib/agent-roles.ts.

alter table public.agents
  add column if not exists role text not null default 'agent';

alter table public.agents drop constraint if exists agents_role_check;
alter table public.agents
  add constraint agents_role_check check (
    role in ('agent', 'branches', 'retention', 'shift_lead', 'coordinator', 'manager', 'inactive')
  );

comment on column public.agents.role is
  'Job role: agent (נציגת מענה) | branches (נציגת סניפים) | retention (שימור לקוחות) | shift_lead (אחמ"שית) | coordinator (מתאמת) | manager (מנהלת) | inactive (לא עובד/ת). Set by admins in "נציגים וצוותים"; the Aircall roster sync never touches it.';

-- Admins may change an agent's role from the app (the roster sync writes
-- with the service role and is unaffected).
drop policy if exists "admins update agents" on public.agents;
create policy "admins update agents"
  on public.agents for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- Initial assignment from the account owner (2026-09-10).
update public.agents set role = 'manager'     where name = 'לירן רבני';
update public.agents set role = 'shift_lead'  where name in ('שני דנוך', 'אורטל צפניה');
update public.agents set role = 'coordinator' where name in ('נוי עזגד', 'קורל ויזמן');
