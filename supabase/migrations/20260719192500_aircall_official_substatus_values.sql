create or replace function private.aircall_state_from_user(user_data jsonb)
returns public.agent_state
language sql
immutable
set search_path = ''
as $$
  select case lower(coalesce(user_data ->> 'substatus', ''))
    when 'always_open' then 'available'::public.agent_state
    when 'always_opened' then 'available'::public.agent_state
    when 'available' then 'available'::public.agent_state
    when 'according_to_schedule' then 'scheduled'::public.agent_state
    when 'scheduled' then 'scheduled'::public.agent_state
    when 'out_for_lunch' then 'out_for_lunch'::public.agent_state
    when 'lunch' then 'out_for_lunch'::public.agent_state
    when 'on_a_break' then 'on_break'::public.agent_state
    when 'on_break' then 'on_break'::public.agent_state
    when 'break' then 'on_break'::public.agent_state
    when 'in_training' then 'in_training'::public.agent_state
    when 'training' then 'in_training'::public.agent_state
    when 'doing_back_office' then 'back_office'::public.agent_state
    when 'back_office' then 'back_office'::public.agent_state
    when 'other' then 'other'::public.agent_state
    when 'always_closed' then 'unavailable'::public.agent_state
    else case lower(coalesce(
      user_data ->> 'availability_status',
      user_data ->> 'available',
      ''
    ))
      when 'available' then 'available'::public.agent_state
      when 'custom' then 'scheduled'::public.agent_state
      when 'true' then 'available'::public.agent_state
      else 'unavailable'::public.agent_state
    end
  end;
$$;

revoke all on function private.aircall_state_from_user(jsonb)
  from public, anon, authenticated;
