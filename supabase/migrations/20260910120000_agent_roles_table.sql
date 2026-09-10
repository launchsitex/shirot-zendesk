-- Agent job roles become data the admin manages in Settings ("תפקידי
-- נציגות") instead of a fixed list in code: add, rename, reorder, delete.
-- Replaces the CHECK constraint from 20260910100000_agent_roles.sql with a
-- lookup table and a foreign key.
--
-- PostgREST note (PROJECT_CONTEXT.md, "PostgREST embeds"): agents now holds
-- FKs to both departments and agent_roles, so PostgREST also sees agents as
-- a junction between those two. Nothing embeds departments↔agent_roles, and
-- every agents→departments embed is already hinted, so no query changes.

create table if not exists public.agent_roles (
  id text primary key,
  -- Singular, for the picker on an agent card ("נציגת מענה").
  label text not null,
  -- Plural, for the group heading in "זמינות נציגות" ("נציגות מענה").
  group_label text not null,
  -- Display order of the availability groups; answering agents first.
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.agent_roles is
  'Agent job roles managed in Settings. "agent" is the default role for every new agent and cannot be deleted; only the WhatsApp availability boxes read roles.';

insert into public.agent_roles (id, label, group_label, sort_order) values
  ('agent',       'נציגת מענה',   'נציגות מענה',   10),
  ('branches',    'נציגת סניפים', 'נציגות סניפים', 20),
  ('retention',   'שימור לקוחות', 'שימור לקוחות',  30),
  ('shift_lead',  'אחמ"שית',      'אחמ"שיות',      40),
  ('coordinator', 'מתאמת',        'מתאמות',        50),
  ('manager',     'מנהלת',        'מנהלות',        60),
  ('inactive',    'לא עובד/ת',    'לא עובדות',     70)
on conflict (id) do nothing;

alter table public.agents drop constraint if exists agents_role_check;
alter table public.agents drop constraint if exists agents_role_fkey;
alter table public.agents
  add constraint agents_role_fkey
  foreign key (role) references public.agent_roles(id)
  on update cascade on delete restrict;

alter table public.agent_roles enable row level security;

drop policy if exists "authenticated read agent roles" on public.agent_roles;
create policy "authenticated read agent roles"
  on public.agent_roles for select to authenticated using (true);

drop policy if exists "admins write agent roles" on public.agent_roles;
create policy "admins write agent roles"
  on public.agent_roles for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
