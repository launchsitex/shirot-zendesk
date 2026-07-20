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
  if new.raw ->> 'provider' is distinct from 'aircall' then
    return new;
  end if;

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

drop trigger if exists aircall_team_department_sync on public.zendesk_groups;
create trigger aircall_team_department_sync
after insert or update of name, raw on public.zendesk_groups
for each row execute function private.sync_aircall_team_department();

create or replace function private.assign_aircall_call_department()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  team_id text;
  target_department_id text;
begin
  if new.raw ->> 'provider' is distinct from 'aircall' then
    return new;
  end if;

  team_id := new.raw -> 'teams' -> 0 ->> 'id';
  if team_id is null then
    return new;
  end if;

  select department_id into target_department_id
  from public.department_groups
  where group_id = team_id;

  if target_department_id is not null then
    new.department_id := target_department_id;
    if new.agent_id is not null then
      insert into public.agent_group_memberships (agent_id, group_id)
      values (new.agent_id, team_id)
      on conflict (agent_id, group_id) do nothing;

      update public.agents
      set department_id = target_department_id
      where id = new.agent_id;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists aircall_call_department_assignment on public.calls;
create trigger aircall_call_department_assignment
before insert or update of agent_id, raw on public.calls
for each row execute function private.assign_aircall_call_department();

revoke all on function private.sync_aircall_team_department()
  from public, anon, authenticated;
revoke all on function private.assign_aircall_call_department()
  from public, anon, authenticated;
