-- Customer satisfaction survey module (רהיטי הסיטי).
-- One survey per completed order (sale + coordination + delivery combined into
-- a single form, three separate scores), sent once via SMS after the order is
-- fully delivered. Branches / coordinators / movers are lookup tables kept in
-- sync by upserting rows from each manual Excel import (Priority API sync is
-- a later phase — see PROJECT_CONTEXT.md).

create table if not exists public.survey_branches (
  id text primary key,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.survey_branches is 'Store branches (from Priority), auto-upserted on each survey Excel import.';

create table if not exists public.survey_coordinators (
  id text primary key,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.survey_coordinators is 'Delivery-coordination / office staff (from Priority), auto-upserted on each survey Excel import.';

create table if not exists public.survey_movers (
  id text primary key,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.survey_movers is 'Delivery/mover teams (from Priority), auto-upserted on each survey Excel import.';

create table if not exists public.survey_message_template (
  id text primary key default 'default',
  template_text text not null,
  updated_at timestamptz not null default now()
);
comment on table public.survey_message_template is 'Single global SMS invitation text; supports {שם_לקוח}/{מספר_הזמנה}/{קישור} placeholders.';

insert into public.survey_message_template (id, template_text)
values ('default', 'שלום {שם_לקוח}, נשמח לשמוע איך היה השירות אצלנו בהזמנה {מספר_הזמנה}. לחץ/י כאן: {קישור}')
on conflict (id) do nothing;

create table if not exists public.survey_pending_sends (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null,
  phone text not null,
  order_number text not null,
  branch_id text references public.survey_branches(id),
  coordinator_id text references public.survey_coordinators(id),
  mover_id text references public.survey_movers(id),
  token text not null unique,
  message_text text not null,
  status text not null default 'pending' check (status in ('pending', 'sent')),
  sent_at timestamptz,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.survey_pending_sends is 'Queue of customers awaiting/having received the post-delivery survey SMS, one row per order.';
create index if not exists survey_pending_sends_status_idx on public.survey_pending_sends (status);
create index if not exists survey_pending_sends_branch_idx on public.survey_pending_sends (branch_id);
create index if not exists survey_pending_sends_order_idx on public.survey_pending_sends (order_number);

create table if not exists public.survey_responses (
  id uuid primary key default gen_random_uuid(),
  pending_send_id uuid not null references public.survey_pending_sends(id),
  order_number text not null,
  branch_id text references public.survey_branches(id),
  coordinator_id text references public.survey_coordinators(id),
  mover_id text references public.survey_movers(id),
  score_branch smallint not null check (score_branch between 1 and 5),
  score_coordination smallint not null check (score_coordination between 1 and 5),
  score_mover smallint not null check (score_mover between 1 and 5),
  feedback_positive text,
  feedback_negative text,
  submitted_at timestamptz not null default now()
);
comment on table public.survey_responses is 'One row per completed survey submission; three scores (branch/coordination/mover) cover the whole order journey.';
create unique index if not exists survey_responses_pending_send_unique on public.survey_responses (pending_send_id);
create index if not exists survey_responses_branch_idx on public.survey_responses (branch_id);
create index if not exists survey_responses_order_idx on public.survey_responses (order_number);

create trigger survey_branches_set_updated_at before update on public.survey_branches for each row execute function public.set_updated_at();
create trigger survey_coordinators_set_updated_at before update on public.survey_coordinators for each row execute function public.set_updated_at();
create trigger survey_movers_set_updated_at before update on public.survey_movers for each row execute function public.set_updated_at();
create trigger survey_pending_sends_set_updated_at before update on public.survey_pending_sends for each row execute function public.set_updated_at();

-- profiles.branch_id: scoping column for a future "branch manager" role,
-- mirrors the existing department_id scoping pattern. Added now (cheap, same
-- migration) but not yet enforced in RLS below — branch-scoped policies land
-- in a follow-up migration once the branch-manager pages exist.
alter table public.profiles add column if not exists branch_id text references public.survey_branches(id);

-- RLS: any authenticated staff member can manage everything for now (page-level
-- access control via allowed_pages keeps this admin-only until granted, same as
-- every other new module). Branch-level RLS scoping is a fast-follow once the
-- branch-manager role is built. The public survey view/submit flow NEVER uses
-- PostgREST directly (no anon policies here) — it goes through dedicated edge
-- functions using the service role, so customer name/phone can't be enumerated.

alter table public.survey_branches enable row level security;
alter table public.survey_coordinators enable row level security;
alter table public.survey_movers enable row level security;
alter table public.survey_message_template enable row level security;
alter table public.survey_pending_sends enable row level security;
alter table public.survey_responses enable row level security;

create policy survey_branches_staff_all on public.survey_branches
  for all to authenticated using (true) with check (true);

create policy survey_coordinators_staff_all on public.survey_coordinators
  for all to authenticated using (true) with check (true);

create policy survey_movers_staff_all on public.survey_movers
  for all to authenticated using (true) with check (true);

create policy survey_message_template_staff_all on public.survey_message_template
  for all to authenticated using (true) with check (true);

create policy survey_pending_sends_staff_all on public.survey_pending_sends
  for all to authenticated using (true) with check (true);

create policy survey_responses_staff_all on public.survey_responses
  for all to authenticated using (true) with check (true);
