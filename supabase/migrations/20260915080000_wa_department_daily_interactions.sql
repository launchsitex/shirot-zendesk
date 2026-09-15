-- "אינטראקציה יומית" — distinct WhatsApp customers a department's agents
-- actually messaged on a given day, regardless of when the ticket was
-- opened (account owner, 2026-09-15: different from wa_agent_daily's
-- ticketCount, which is keyed by the ticket's own open day). Sourced from
-- zendesk_whatsapp_messages (direction = 'agent'), which only goes back to
-- 2026-09-09 — there is no earlier data to backfill.

create table if not exists public.wa_department_daily_interactions (
  day date not null,
  department_id text not null references public.departments(id),
  customer_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (day, department_id)
);

create or replace function public.recompute_wa_department_daily_interactions(p_day date)
returns void
language plpgsql
as $$
begin
  insert into public.wa_department_daily_interactions (day, department_id, customer_count, updated_at)
  select
    p_day,
    zgd.department_id,
    count(distinct m.ticket_id),
    now()
  from public.zendesk_whatsapp_messages m
  join public.zendesk_tickets t on t.id = m.ticket_id
  join public.zendesk_group_departments zgd on zgd.group_id = t.group_id
  where m.direction = 'agent'
    and (m.at at time zone 'Asia/Jerusalem')::date = p_day
  group by zgd.department_id
  on conflict (day, department_id)
  do update set customer_count = excluded.customer_count, updated_at = excluded.updated_at;

  -- A department with zero agent messages that day still needs a row, so
  -- the UI can tell "zero" apart from "not computed yet".
  insert into public.wa_department_daily_interactions (day, department_id, customer_count, updated_at)
  select p_day, d.id, 0, now()
  from public.departments d
  where not exists (
    select 1 from public.wa_department_daily_interactions w
    where w.day = p_day and w.department_id = d.id
  );
end;
$$;

select cron.schedule(
  'wa-department-daily-interactions-rollup',
  '*/10 * * * *',
  $$
    select public.recompute_wa_department_daily_interactions(d::date)
    from generate_series(
      (now() at time zone 'Asia/Jerusalem')::date - 1,
      (now() at time zone 'Asia/Jerusalem')::date,
      interval '1 day'
    ) d;
  $$
);

select cron.schedule(
  'wa-department-daily-interactions-rollup-nightly',
  '35 0 * * *',
  $$
    select public.recompute_wa_department_daily_interactions(d::date)
    from generate_series(
      (now() at time zone 'Asia/Jerusalem')::date - 31,
      (now() at time zone 'Asia/Jerusalem')::date,
      interval '1 day'
    ) d;
  $$
);

-- Backfill everything the message log has.
select public.recompute_wa_department_daily_interactions(d::date)
from generate_series('2026-09-09'::date, (now() at time zone 'Asia/Jerusalem')::date, interval '1 day') d;
