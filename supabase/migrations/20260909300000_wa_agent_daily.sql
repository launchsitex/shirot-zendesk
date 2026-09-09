-- Daily WhatsApp performance per agent, kept for good: the account owner
-- pays and bonuses agents on these figures and wants to compare days and
-- weeks, so they are rolled up into a table by the database itself rather
-- than recomputed from live tickets on every view. Same definitions as
-- "דשבורד WA" (src/lib/wa-dashboard.ts, src/app/api/wa-dashboard/route.ts):
--   * a ticket belongs to the Israel calendar day it was opened on;
--   * "tickets" are credited to the current assignee, a first response to
--     first_response_agent_id (the agent assigned when the first agent
--     message was sent), a closure to solved_by_agent_id;
--   * every duration runs on the department's business clock — the hours
--     kept in department_business_hours, standing still on Fridays,
--     Saturdays, Israeli holidays and their eves (src/lib/business-clock.ts,
--     src/lib/israel-holidays.ts). The SQL clock below mirrors that code
--     line for line; src/lib/business-clock.test.ts cases were replayed
--     against it when it was applied.

-- ---------------------------------------------------------------------------
-- Israeli holidays the call center is closed on, generated from
-- src/lib/israel-holidays.ts for 2026–2030 (regenerate and re-seed before
-- 2031; the TypeScript side computes them from the Hebrew calendar and needs
-- no table).
create table if not exists public.israel_holidays (
  day date primary key,
  name text not null
);
comment on table public.israel_holidays is
  'Days the call center is closed for an Israeli holiday or its eve (Asia/Jerusalem dates). Seeded from src/lib/israel-holidays.ts.';

alter table public.israel_holidays enable row level security;
drop policy if exists "authenticated read israel holidays" on public.israel_holidays;
create policy "authenticated read israel holidays"
  on public.israel_holidays for select to authenticated using (true);

insert into public.israel_holidays (day, name) values
('2026-04-01', 'ערב פסח'),
('2026-04-02', 'פסח'),
('2026-04-07', 'ערב שביעי של פסח'),
('2026-04-08', 'שביעי של פסח'),
('2026-04-22', 'יום העצמאות'),
('2026-05-21', 'ערב שבועות'),
('2026-05-22', 'שבועות'),
('2026-09-11', 'ערב ראש השנה'),
('2026-09-12', 'ראש השנה'),
('2026-09-13', 'ראש השנה'),
('2026-09-20', 'ערב יום כיפור'),
('2026-09-21', 'יום כיפור'),
('2026-09-25', 'ערב סוכות'),
('2026-09-26', 'סוכות'),
('2026-10-02', 'ערב שמחת תורה'),
('2026-10-03', 'שמחת תורה'),
('2027-04-21', 'ערב פסח'),
('2027-04-22', 'פסח'),
('2027-04-27', 'ערב שביעי של פסח'),
('2027-04-28', 'שביעי של פסח'),
('2027-05-12', 'יום העצמאות'),
('2027-06-10', 'ערב שבועות'),
('2027-06-11', 'שבועות'),
('2027-10-01', 'ערב ראש השנה'),
('2027-10-02', 'ראש השנה'),
('2027-10-03', 'ראש השנה'),
('2027-10-10', 'ערב יום כיפור'),
('2027-10-11', 'יום כיפור'),
('2027-10-15', 'ערב סוכות'),
('2027-10-16', 'סוכות'),
('2027-10-22', 'ערב שמחת תורה'),
('2027-10-23', 'שמחת תורה'),
('2028-04-10', 'ערב פסח'),
('2028-04-11', 'פסח'),
('2028-04-16', 'ערב שביעי של פסח'),
('2028-04-17', 'שביעי של פסח'),
('2028-05-02', 'יום העצמאות'),
('2028-05-30', 'ערב שבועות'),
('2028-05-31', 'שבועות'),
('2028-09-20', 'ערב ראש השנה'),
('2028-09-21', 'ראש השנה'),
('2028-09-22', 'ראש השנה'),
('2028-09-29', 'ערב יום כיפור'),
('2028-09-30', 'יום כיפור'),
('2028-10-04', 'ערב סוכות'),
('2028-10-05', 'סוכות'),
('2028-10-11', 'ערב שמחת תורה'),
('2028-10-12', 'שמחת תורה'),
('2029-03-30', 'ערב פסח'),
('2029-03-31', 'פסח'),
('2029-04-05', 'ערב שביעי של פסח'),
('2029-04-06', 'שביעי של פסח'),
('2029-04-19', 'יום העצמאות'),
('2029-05-19', 'ערב שבועות'),
('2029-05-20', 'שבועות'),
('2029-09-09', 'ערב ראש השנה'),
('2029-09-10', 'ראש השנה'),
('2029-09-11', 'ראש השנה'),
('2029-09-18', 'ערב יום כיפור'),
('2029-09-19', 'יום כיפור'),
('2029-09-23', 'ערב סוכות'),
('2029-09-24', 'סוכות'),
('2029-09-30', 'ערב שמחת תורה'),
('2029-10-01', 'שמחת תורה'),
('2030-04-17', 'ערב פסח'),
('2030-04-18', 'פסח'),
('2030-04-23', 'ערב שביעי של פסח'),
('2030-04-24', 'שביעי של פסח'),
('2030-05-08', 'יום העצמאות'),
('2030-06-06', 'ערב שבועות'),
('2030-06-07', 'שבועות'),
('2030-09-27', 'ערב ראש השנה'),
('2030-09-28', 'ראש השנה'),
('2030-09-29', 'ראש השנה'),
('2030-10-06', 'ערב יום כיפור'),
('2030-10-07', 'יום כיפור'),
('2030-10-11', 'ערב סוכות'),
('2030-10-12', 'סוכות'),
('2030-10-18', 'ערב שמחת תורה'),
('2030-10-19', 'שמחת תורה')
on conflict (day) do update set name = excluded.name;

-- ---------------------------------------------------------------------------
-- The business clock: seconds between two instants that fall inside the
-- weekly schedule's open windows (Israel time), skipping holidays; plain
-- elapsed seconds when the schedule has no open day. Never negative.
create or replace function public.business_seconds(
  p_from timestamptz,
  p_to timestamptz,
  p_schedule jsonb
) returns integer
language plpgsql
stable
set search_path = ''
as $$
declare
  v_open_days integer;
  v_day date;
  v_last date;
  v_entry jsonb;
  v_open timestamptz;
  v_close timestamptz;
  v_overlap interval;
  v_total interval := interval '0';
  v_step integer := 0;
begin
  if p_from is null or p_to is null or p_to <= p_from then
    return 0;
  end if;

  select count(*) into v_open_days
  from jsonb_array_elements(coalesce(p_schedule, '[]'::jsonb)) e
  where coalesce((e->>'isOpen')::boolean, false);
  if v_open_days = 0 then
    return floor(extract(epoch from p_to - p_from))::integer;
  end if;

  -- Start a day early: an overnight window (open 20:00, close 02:00) that
  -- began the previous evening can still be running at p_from.
  v_day := (p_from at time zone 'Asia/Jerusalem')::date - 1;
  v_last := (p_to at time zone 'Asia/Jerusalem')::date;

  while v_day <= v_last and v_step < 400 loop
    select e into v_entry
    from jsonb_array_elements(p_schedule) e
    where (e->>'day')::integer = extract(dow from v_day)::integer
      and coalesce((e->>'isOpen')::boolean, false)
    limit 1;

    if v_entry is not null
       and not exists (select 1 from public.israel_holidays h where h.day = v_day) then
      v_open := (v_day + (v_entry->>'open')::time) at time zone 'Asia/Jerusalem';
      v_close := (v_day + (v_entry->>'close')::time) at time zone 'Asia/Jerusalem';
      if v_close <= v_open then
        v_close := (v_day + 1 + (v_entry->>'close')::time) at time zone 'Asia/Jerusalem';
      end if;
      v_overlap := least(p_to, v_close) - greatest(p_from, v_open);
      if v_overlap > interval '0' then
        v_total := v_total + v_overlap;
      end if;
    end if;

    v_day := v_day + 1;
    v_step := v_step + 1;
  end loop;

  return floor(extract(epoch from v_total))::integer;
end;
$$;

grant execute on function public.business_seconds(timestamptz, timestamptz, jsonb)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- One row per agent per day per department. Sums, not averages, so any range
-- of days (or agents) adds up exactly on the way out.
create table if not exists public.wa_agent_daily (
  day date not null,
  department_id text not null references public.departments(id) on delete cascade,
  agent_id text not null references public.agents(id) on delete cascade,
  -- Tickets opened that day currently assigned to the agent, and how many of
  -- those are still not solved/closed.
  ticket_count integer not null default 0,
  open_count integer not null default 0,
  -- Tickets opened that day the agent is credited with closing, and their
  -- total business-clock time from opening to the solved moment.
  closed_count integer not null default 0,
  time_to_close_seconds_sum bigint not null default 0,
  -- Tickets opened that day the agent is credited with the first human
  -- reply on, their total business-clock time from the bot's handoff to
  -- that reply, and how many crossed each escalation tier.
  responded_count integer not null default 0,
  first_response_seconds_sum bigint not null default 0,
  under_3_count integer not null default 0,
  over_3_count integer not null default 0,
  over_7_count integer not null default 0,
  over_10_count integer not null default 0,
  computed_at timestamptz not null default now(),
  primary key (day, department_id, agent_id)
);
create index if not exists wa_agent_daily_department_day_idx
  on public.wa_agent_daily (department_id, day);

comment on table public.wa_agent_daily is
  'Daily WhatsApp performance per agent (Israel calendar day the ticket was opened). Recomputed by recompute_wa_agent_daily; durations on the business clock.';

alter table public.wa_agent_daily enable row level security;
drop policy if exists "department scoped read wa agent daily" on public.wa_agent_daily;
create policy "department scoped read wa agent daily"
  on public.wa_agent_daily for select to authenticated
  using (
    (select public.is_admin())
    or (select private.current_department_id()) is null
    or department_id = (select private.current_department_id())
  );

-- ---------------------------------------------------------------------------
-- Rebuild one day. Deleting and re-inserting keeps a ticket that moved to
-- another agent, or was closed days later, credited correctly.
create or replace function public.recompute_wa_agent_daily(p_day date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start timestamptz := (p_day::timestamp) at time zone 'Asia/Jerusalem';
  v_end timestamptz := ((p_day + 1)::timestamp) at time zone 'Asia/Jerusalem';
  v_rows integer;
begin
  delete from public.wa_agent_daily where day = p_day;

  with tickets as (
    select
      t.agent_id,
      t.status in ('solved', 'closed') as is_closed,
      t.zendesk_created_at,
      coalesce(t.handed_to_agent_at, t.zendesk_created_at) as clock_start,
      t.first_agent_message_at,
      coalesce(t.solved_at, t.zendesk_updated_at) as closed_at,
      coalesce(
        t.first_response_agent_id,
        case when t.first_agent_message_at is not null then t.agent_id end
      ) as responder_id,
      coalesce(
        t.solved_by_agent_id,
        case when t.status in ('solved', 'closed') then t.agent_id end
      ) as closer_id
    from public.zendesk_tickets t
    where t.via_channel = 'whatsapp'
      and t.status <> 'deleted'
      and t.zendesk_created_at >= v_start
      and t.zendesk_created_at < v_end
  ),
  roster as (
    select a.id, a.department_id, h.schedule
    from public.agents a
    left join public.department_business_hours h on h.department_id = a.department_id
    where a.department_id is not null
  ),
  assigned as (
    select agent_id,
      count(*)::integer as ticket_count,
      count(*) filter (where not is_closed)::integer as open_count
    from tickets
    where agent_id is not null
    group by agent_id
  ),
  responses as (
    select t.responder_id as agent_id,
      public.business_seconds(t.clock_start, t.first_agent_message_at, r.schedule) as seconds
    from tickets t
    join roster r on r.id = t.responder_id
    where t.first_agent_message_at is not null
  ),
  responded as (
    select agent_id,
      count(*)::integer as responded_count,
      sum(seconds)::bigint as first_response_seconds_sum,
      count(*) filter (where seconds < 180)::integer as under_3_count,
      count(*) filter (where seconds >= 180)::integer as over_3_count,
      count(*) filter (where seconds >= 420)::integer as over_7_count,
      count(*) filter (where seconds >= 600)::integer as over_10_count
    from responses
    group by agent_id
  ),
  closures as (
    select t.closer_id as agent_id,
      public.business_seconds(t.zendesk_created_at, t.closed_at, r.schedule) as seconds
    from tickets t
    join roster r on r.id = t.closer_id
    where t.is_closed
  ),
  closed as (
    select agent_id,
      count(*)::integer as closed_count,
      sum(seconds)::bigint as time_to_close_seconds_sum
    from closures
    group by agent_id
  ),
  agent_ids as (
    select agent_id from assigned
    union select agent_id from responded
    union select agent_id from closed
  )
  insert into public.wa_agent_daily (
    day, department_id, agent_id,
    ticket_count, open_count,
    closed_count, time_to_close_seconds_sum,
    responded_count, first_response_seconds_sum,
    under_3_count, over_3_count, over_7_count, over_10_count,
    computed_at
  )
  select
    p_day, r.department_id, r.id,
    coalesce(a.ticket_count, 0), coalesce(a.open_count, 0),
    coalesce(c.closed_count, 0), coalesce(c.time_to_close_seconds_sum, 0),
    coalesce(f.responded_count, 0), coalesce(f.first_response_seconds_sum, 0),
    coalesce(f.under_3_count, 0), coalesce(f.over_3_count, 0),
    coalesce(f.over_7_count, 0), coalesce(f.over_10_count, 0),
    now()
  from agent_ids ids
  join roster r on r.id = ids.agent_id
  left join assigned a on a.agent_id = ids.agent_id
  left join responded f on f.agent_id = ids.agent_id
  left join closed c on c.agent_id = ids.agent_id;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke execute on function public.recompute_wa_agent_daily(date) from public, anon, authenticated;
grant execute on function public.recompute_wa_agent_daily(date) to service_role;

-- ---------------------------------------------------------------------------
-- Keep it current: today and yesterday every ten minutes (a ticket closed
-- after midnight still lands on the day it was opened), and the last 31 days
-- nightly for tickets closed or reassigned days later.
select cron.unschedule('wa-agent-daily-rollup')
where exists (select 1 from cron.job where jobname = 'wa-agent-daily-rollup');
select cron.schedule(
  'wa-agent-daily-rollup',
  '*/10 * * * *',
  $$
    select public.recompute_wa_agent_daily(d::date)
    from generate_series(
      (now() at time zone 'Asia/Jerusalem')::date - 1,
      (now() at time zone 'Asia/Jerusalem')::date,
      interval '1 day'
    ) d;
  $$
);

select cron.unschedule('wa-agent-daily-rollup-nightly')
where exists (select 1 from cron.job where jobname = 'wa-agent-daily-rollup-nightly');
select cron.schedule(
  'wa-agent-daily-rollup-nightly',
  '30 0 * * *',
  $$
    select public.recompute_wa_agent_daily(d::date)
    from generate_series(
      (now() at time zone 'Asia/Jerusalem')::date - 31,
      (now() at time zone 'Asia/Jerusalem')::date,
      interval '1 day'
    ) d;
  $$
);

-- Backfill everything the sync holds (tickets since 1 August 2026; handoff
-- and first-reply data is complete from 8 September, partial from 25 August).
select public.recompute_wa_agent_daily(d::date)
from generate_series('2026-08-01'::date, (now() at time zone 'Asia/Jerusalem')::date, interval '1 day') d;
