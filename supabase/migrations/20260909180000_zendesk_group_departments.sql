-- A WhatsApp ticket the bot has handed off but no agent has picked up yet has
-- no assignee, so it has no department through the agent roster — and was
-- invisible on the WhatsApp dashboards, which is exactly when a customer is
-- waiting in a queue. Zendesk's routing puts it in a group, and each group
-- maps to one of our departments (checked on ~5,000 WhatsApp tickets this
-- month: group 47486554986641 is Customer Service on 2,836 tickets and
-- Deliveries on none; 44122190929553 the other way round on 1,397).
--
-- Kept as data rather than a constant so a new group can be mapped with one
-- row instead of a deploy. Unmapped groups show as "ללא שיוך מחלקה".

create table if not exists public.zendesk_group_departments (
  group_id text primary key,
  department_id text not null references public.departments (id) on delete cascade,
  note text
);

alter table public.zendesk_group_departments enable row level security;

drop policy if exists "read zendesk group departments" on public.zendesk_group_departments;
create policy "read zendesk group departments"
  on public.zendesk_group_departments
  for select to authenticated
  using (true);

insert into public.zendesk_group_departments (group_id, department_id, note) values
  ('47486554986641', 'customer-service', 'WhatsApp routing group, customer service'),
  ('48454271689489', 'customer-service', 'Secondary customer-service group (20 tickets)'),
  ('44122190929553', 'deliveries', 'WhatsApp routing group, deliveries')
on conflict (group_id) do nothing;
