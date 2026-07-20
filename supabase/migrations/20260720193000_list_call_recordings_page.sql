create or replace function public.list_call_recordings_page(
  p_page integer default 1,
  p_page_size integer default 20,
  p_department_id text default null,
  p_recording_type text default null,
  p_search text default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_size integer := least(greatest(coalesce(p_page_size, 20), 1), 100);
  v_search text := nullif(trim(coalesce(p_search, '')), '');
  v_digits text := nullif(regexp_replace(coalesce(p_search, ''), '\D', '', 'g'), '');
  v_total bigint;
  v_duration bigint;
  v_voicemail bigint;
  v_rows jsonb;
begin
  with filtered as (
    select
      r.id,
      r.call_id,
      r.ticket_id,
      r.recording_type,
      r.duration_seconds,
      r.created_at,
      c.customer_number,
      c.department_id,
      a.name as agent_name,
      d.name as department_name
    from public.call_recordings r
    inner join public.calls c on c.id = r.call_id
    left join public.agents a on a.id = c.agent_id
    left join public.departments d on d.id = c.department_id
    where
      (p_department_id is null or c.department_id = p_department_id)
      and (p_recording_type is null or r.recording_type = p_recording_type)
      and (
        v_search is null
        or r.ticket_id ilike '%' || v_search || '%'
        or coalesce(a.name, '') ilike '%' || v_search || '%'
        or (
          v_digits is not null
          and regexp_replace(coalesce(c.customer_number, ''), '\D', '', 'g') like '%' || v_digits || '%'
        )
      )
  ),
  stats as (
    select
      count(*)::bigint as total_count,
      coalesce(sum(duration_seconds), 0)::bigint as total_duration_seconds,
      count(*) filter (where recording_type = 'voicemail')::bigint as voicemail_count
    from filtered
  ),
  page_rows as (
    select *
    from filtered
    order by created_at desc
    limit v_size
    offset (v_page - 1) * v_size
  )
  select
    s.total_count,
    s.total_duration_seconds,
    s.voicemail_count,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', p.id,
            'callId', p.call_id,
            'ticketId', p.ticket_id,
            'recordingType', p.recording_type,
            'durationSeconds', p.duration_seconds,
            'createdAt', p.created_at,
            'agentName', p.agent_name,
            'departmentId', p.department_id,
            'departmentName', p.department_name,
            'customerNumber', coalesce(p.customer_number, '')
          )
          order by p.created_at desc
        )
        from page_rows p
      ),
      '[]'::jsonb
    )
  into v_total, v_duration, v_voicemail, v_rows
  from stats s;

  return jsonb_build_object(
    'recordings', v_rows,
    'page', v_page,
    'pageSize', v_size,
    'totalCount', v_total,
    'totalPages', greatest(ceil(v_total::numeric / v_size::numeric), 1)::integer,
    'totalDurationSeconds', v_duration,
    'voicemailCount', v_voicemail
  );
end;
$$;

revoke all on function public.list_call_recordings_page(integer, integer, text, text, text) from public;
grant execute on function public.list_call_recordings_page(integer, integer, text, text, text) to authenticated;
grant execute on function public.list_call_recordings_page(integer, integer, text, text, text) to service_role;

comment on function public.list_call_recordings_page is
  'Paginated call recordings list with optional department/type/search filters.';
