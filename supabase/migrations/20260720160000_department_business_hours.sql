-- Business hours per department + global after-hours routing toggle

create table if not exists public.app_feature_flags (
  key text primary key,
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create table if not exists public.department_business_hours (
  department_id text primary key references public.departments(id) on delete cascade,
  -- Weekly schedule in Asia/Jerusalem local time.
  -- Each item: { "day": 0-6 (Sun=0), "open": "09:00", "close": "18:00", "isOpen": true }
  schedule jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint department_business_hours_schedule_is_array
    check (jsonb_typeof(schedule) = 'array')
);

comment on table public.app_feature_flags is
  'Global feature toggles. after_hours_routing.enabled gates after-hours call separation.';
comment on table public.department_business_hours is
  'Inbound business hours per department (Israel local time). Used only when after_hours_routing is enabled.';

insert into public.app_feature_flags (key, enabled)
values ('after_hours_routing', false)
on conflict (key) do nothing;

-- Seed empty schedules for known departments
insert into public.department_business_hours (department_id, schedule)
select d.id, '[]'::jsonb
from public.departments d
where d.id in ('customer-service', 'deliveries')
on conflict (department_id) do nothing;

alter table public.app_feature_flags enable row level security;
alter table public.department_business_hours enable row level security;

drop policy if exists "authenticated read feature flags" on public.app_feature_flags;
create policy "authenticated read feature flags"
  on public.app_feature_flags for select to authenticated
  using (true);

drop policy if exists "admins write feature flags" on public.app_feature_flags;
create policy "admins write feature flags"
  on public.app_feature_flags for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "authenticated read business hours" on public.department_business_hours;
create policy "authenticated read business hours"
  on public.department_business_hours for select to authenticated
  using (true);

drop policy if exists "admins write business hours" on public.department_business_hours;
create policy "admins write business hours"
  on public.department_business_hours for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

revoke all on table public.app_feature_flags from anon;
revoke all on table public.department_business_hours from anon;
grant select on table public.app_feature_flags to authenticated;
grant select, insert, update, delete on table public.department_business_hours to authenticated;
grant select, insert, update, delete on table public.app_feature_flags to authenticated;
