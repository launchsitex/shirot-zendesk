-- Applied to the live project on 2026-08-06.
--
-- A ticket opened at 16:38:58 only reached the screen around 16:43: up to two
-- minutes waiting for the sync, then up to a minute for the page's refresh.
-- The data was never wrong, it was just slow, and the interval could not simply
-- be shortened — every refresh was fetching all 8,000+ tickets in the range
-- (~1.5MB, nine paged round trips) purely to count them in the browser. Polling
-- that harder from several office tabs is the same per-IP request volume that
-- tripped the host's flood protection on the call pages.
--
-- So: count in the database, cap the list, and only then speed things up.

-- Per-agent open/closed counts over the whole range.
-- SECURITY INVOKER so the department scoping on zendesk_tickets applies to the
-- caller exactly as it does for a direct select.
create or replace function public.zendesk_ticket_summary(
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  agent_id text,
  agent_name text,
  department_name text,
  open_count bigint,
  closed_count bigint,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    t.agent_id,
    -- Fall back to the Zendesk assignee so a ticket handled by somebody outside
    -- the call centre roster still shows an owner rather than vanishing.
    coalesce(a.name, t.assignee_name, 'ללא שיוך נציג') as agent_name,
    d.name as department_name,
    count(*) filter (where t.status not in ('solved', 'closed')) as open_count,
    count(*) filter (where t.status in ('solved', 'closed')) as closed_count,
    count(*) as total_count
  from public.zendesk_tickets t
  left join public.agents a on a.id = t.agent_id
  left join public.departments d on d.id = a.department_id
  where t.zendesk_created_at >= p_from
    and t.zendesk_created_at <= p_to
  group by 1, 2, 3
  order by count(*) desc, 2;
$$;

grant execute on function public.zendesk_ticket_summary(timestamptz, timestamptz)
  to authenticated, service_role;

-- Halve the worst-case lag. A steady-state run is a single Zendesk request,
-- well inside the ten per minute that incremental export allows.
select cron.unschedule('zendesk-tickets-sync')
where exists (select 1 from cron.job where jobname = 'zendesk-tickets-sync');

select cron.schedule(
  'zendesk-tickets-sync',
  '* * * * *',
  $$
    select net.http_post(
      url := (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'project_url'
      ) || '/functions/v1/sync-zendesk-tickets',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-sync-secret', (
          select decrypted_secret from vault.decrypted_secrets
          where name = 'sync_function_secret'
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 50000
    );
  $$
);
