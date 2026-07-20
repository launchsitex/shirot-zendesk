-- User management: department assignment + per-user page permissions

alter table public.profiles
  add column if not exists department_id text references public.departments(id) on delete set null,
  add column if not exists allowed_pages text[] not null default '{}'::text[];

comment on column public.profiles.allowed_pages is
  'App page keys the user may open. Admins always get full access regardless of this list.';

create index if not exists profiles_department_id_idx
  on public.profiles (department_id);

drop policy if exists "admins insert profiles" on public.profiles;
create policy "admins insert profiles" on public.profiles
for insert to authenticated
with check (public.is_admin());

drop policy if exists "admins delete profiles" on public.profiles;
create policy "admins delete profiles" on public.profiles
for delete to authenticated
using (public.is_admin());

-- Keep first-signup admin behavior; later signups stay viewer until an admin assigns access.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  initial_role public.app_role;
  page_defaults text[] := array[
    'dashboard',
    'wallboard',
    'calls',
    'recordings',
    'agents',
    'analytics'
  ];
begin
  lock table public.profiles in share row exclusive mode;
  select case
    when exists (select 1 from public.profiles)
      then 'viewer'::public.app_role
    else 'admin'::public.app_role
  end into initial_role;

  insert into public.profiles (id, display_name, role, allowed_pages)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', new.email),
    initial_role,
    case
      when initial_role = 'admin'::public.app_role then '{}'::text[]
      else page_defaults
    end
  );
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

-- Existing admin keeps empty allowed_pages (full access). Existing non-admins get defaults if empty.
update public.profiles
set allowed_pages = array[
  'dashboard',
  'wallboard',
  'calls',
  'recordings',
  'agents',
  'analytics'
]
where role <> 'admin'
  and coalesce(cardinality(allowed_pages), 0) = 0;
