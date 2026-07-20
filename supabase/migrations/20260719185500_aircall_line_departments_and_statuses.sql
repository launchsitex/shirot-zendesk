alter type public.agent_state add value if not exists 'scheduled';
alter type public.agent_state add value if not exists 'out_for_lunch';
alter type public.agent_state add value if not exists 'on_break';
alter type public.agent_state add value if not exists 'in_training';
alter type public.agent_state add value if not exists 'back_office';
alter type public.agent_state add value if not exists 'other';

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
  normalized_name := lower(regexp_replace(new.name, '\s+', '', 'g'));
  target_department_id := case
    when normalized_name like '%שירות%'
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

drop trigger if exists aircall_line_department_sync on public.talk_lines;
create trigger aircall_line_department_sync
after insert or update of name on public.talk_lines
for each row execute function private.sync_aircall_line_department();

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
  normalized_name := lower(regexp_replace(coalesce(number_name, ''), '\s+', '', 'g'));

  if normalized_name like '%שירות%' or normalized_name like '%service%' then
    new.department_id := 'customer-service';
  elsif normalized_name like '%אספק%' or normalized_name like '%deliver%' then
    new.department_id := 'deliveries';
  end if;

  return new;
end;
$$;

drop trigger if exists aircall_agent_department_assignment on public.agents;
create trigger aircall_agent_department_assignment
before insert or update of raw on public.agents
for each row execute function private.assign_aircall_agent_department();

revoke all on function private.sync_aircall_line_department()
  from public, anon, authenticated;
revoke all on function private.assign_aircall_agent_department()
  from public, anon, authenticated;

update public.talk_lines
set name = name;

with latest_user_numbers as (
  select distinct on (payload -> 'data' ->> 'id')
    payload -> 'data' ->> 'id' as agent_id,
    payload -> 'data' -> 'numbers' as numbers
  from public.aircall_webhook_events
  where event_type like 'user.%'
    and jsonb_array_length(coalesce(payload -> 'data' -> 'numbers', '[]'::jsonb)) > 0
  order by payload -> 'data' ->> 'id', received_at desc
)
update public.agents as agent
set raw = jsonb_set(agent.raw, '{numbers}', latest.numbers)
from latest_user_numbers as latest
where agent.id = latest.agent_id;

update public.calls as call
set department_id = line_map.department_id
from public.department_lines as line_map
where line_map.line_id = call.line_id
  and call.department_id is null;

update public.calls as call
set department_id = agent.department_id
from public.agents as agent
where agent.id = call.agent_id
  and agent.department_id is not null
  and call.department_id is null;
