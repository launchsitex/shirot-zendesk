-- Merge Aircall spelling variants like "שרות לקוחות" into customer-service.
-- Root cause: team names without י ("שרות") did not match "%שירותלקוחות%"
-- and created duplicate departments as aircall-team-<id>.

create or replace function private.normalize_aircall_department_name(input_name text)
returns text
language sql
immutable
as $$
  select replace(
    lower(regexp_replace(coalesce(input_name, ''), '\s+', '', 'g')),
    'שרות',
    'שירות'
  );
$$;

create or replace function private.sync_aircall_team_department()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_name text;
  target_department_id text;
  canonical_name text;
begin
  normalized_name := private.normalize_aircall_department_name(new.name);
  target_department_id := case
    when normalized_name like '%שירותלקוחות%'
      or normalized_name like '%שירות%'
      or normalized_name like '%customerservice%'
      then 'customer-service'
    when normalized_name like '%אספק%'
      or normalized_name like '%deliver%'
      then 'deliveries'
    else 'aircall-team-' || new.id
  end;

  canonical_name := case target_department_id
    when 'customer-service' then 'שירות לקוחות'
    when 'deliveries' then 'אספקות'
    else new.name
  end;

  insert into public.departments (id, name, active, sort_order)
  values (
    target_department_id,
    canonical_name,
    true,
    case target_department_id
      when 'customer-service' then 10
      when 'deliveries' then 20
      else 100
    end
  )
  on conflict (id) do update set
    name = excluded.name,
    active = true,
    updated_at = now();

  insert into public.department_groups (department_id, group_id)
  values (target_department_id, new.id)
  on conflict (group_id) do update set
    department_id = excluded.department_id;

  return new;
end;
$$;

create or replace function private.sync_aircall_line_department()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_name text;
  target_department_id text;
begin
  normalized_name := private.normalize_aircall_department_name(new.name);
  target_department_id := case
    when normalized_name like '%שירות%'
      or normalized_name like '%customerservice%'
      or normalized_name like '%service%'
      then 'customer-service'
    when normalized_name like '%אספק%'
      or normalized_name like '%deliver%'
      then 'deliveries'
    else null
  end;

  if target_department_id is not null then
    insert into public.department_lines (department_id, line_id)
    values (target_department_id, new.id)
    on conflict (line_id) do update set
      department_id = excluded.department_id;
  end if;

  return new;
end;
$$;

create or replace function private.assign_aircall_agent_department()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  number_name text;
  normalized_name text;
begin
  if new.raw ->> 'provider' is distinct from 'aircall' then
    return new;
  end if;

  if jsonb_array_length(coalesce(new.raw -> 'numbers', '[]'::jsonb)) = 0
    and tg_op = 'UPDATE'
    and jsonb_array_length(coalesce(old.raw -> 'numbers', '[]'::jsonb)) > 0
  then
    new.raw := jsonb_set(new.raw, '{numbers}', old.raw -> 'numbers');
  end if;

  number_name := new.raw -> 'numbers' -> 0 ->> 'name';
  normalized_name := private.normalize_aircall_department_name(number_name);

  if normalized_name like '%שירות%'
    or normalized_name like '%customerservice%'
    or normalized_name like '%service%'
  then
    new.department_id := 'customer-service';
  elsif normalized_name like '%אספק%' or normalized_name like '%deliver%' then
    new.department_id := 'deliveries';
  end if;

  return new;
end;
$$;

with duplicate_departments as (
  select d.id
  from public.departments d
  where d.id <> 'customer-service'
    and private.normalize_aircall_department_name(d.name) like '%שירות%'
)
update public.agents a
set department_id = 'customer-service'
from duplicate_departments d
where a.department_id = d.id;

with duplicate_departments as (
  select d.id
  from public.departments d
  where d.id <> 'customer-service'
    and private.normalize_aircall_department_name(d.name) like '%שירות%'
)
update public.calls c
set department_id = 'customer-service'
from duplicate_departments d
where c.department_id = d.id;

with duplicate_departments as (
  select d.id
  from public.departments d
  where d.id <> 'customer-service'
    and private.normalize_aircall_department_name(d.name) like '%שירות%'
)
update public.department_groups dg
set department_id = 'customer-service'
from duplicate_departments d
where dg.department_id = d.id;

with duplicate_departments as (
  select d.id
  from public.departments d
  where d.id <> 'customer-service'
    and private.normalize_aircall_department_name(d.name) like '%שירות%'
)
update public.department_lines dl
set department_id = 'customer-service'
from duplicate_departments d
where dl.department_id = d.id;

update public.departments d
set active = false,
    updated_at = now()
where d.id <> 'customer-service'
  and private.normalize_aircall_department_name(d.name) like '%שירות%';

update public.departments
set name = 'שירות לקוחות',
    active = true,
    sort_order = 10,
    updated_at = now()
where id = 'customer-service';

update public.zendesk_groups set name = name;
update public.talk_lines set name = name;
