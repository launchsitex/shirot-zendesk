create or replace function private.sync_aircall_team_department()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_name text;
  target_department_id text;
begin
  normalized_name := lower(regexp_replace(new.name, '\s+', '', 'g'));
  target_department_id := case
    when normalized_name like '%שירותלקוחות%'
      or normalized_name like '%customerservice%'
      then 'customer-service'
    when normalized_name like '%אספק%'
      or normalized_name like '%deliver%'
      then 'deliveries'
    else 'aircall-team-' || new.id
  end;

  insert into public.departments (id, name, active, sort_order)
  values (target_department_id, new.name, true, 100)
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

update public.zendesk_groups
set raw = raw;

update public.calls
set raw = raw
where raw ->> 'provider' = 'aircall';
