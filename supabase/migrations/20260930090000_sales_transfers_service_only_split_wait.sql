-- "העברות מהמכירות" v2, per the owner (2026-09-30), after #87273 showed
-- the page describing the ticket as it is NOW rather than at the call:
--
-- 1. Everything is read AS OF the transfer: the ticket's department (group
--    transitions, recorded since 2026-09-24; older tickets fall back to the
--    current group) and its assignee (assignee transitions, since 08.09).
-- 2. Service only: categories consider customer-service tickets. An open
--    ticket that sat in another department at that moment gets that
--    department's own category (open_deliveries / open_movers /
--    open_branches / other_department) instead of being mixed in.
-- 3. "ממתין לתגובה שלנו" splits into two:
--      waiting_assignment — nobody assigned at the moment of the call
--      waiting_agent      — assigned, the agent had not replied
--    with two business-hours clocks: queue_wait_seconds (from the start of
--    the unanswered stretch, or entry into service, until assignment) and
--    agent_wait_seconds (from assignment until the call).

-- Names and a transfer bucket for every Zendesk group (from /groups.json,
-- 2026-09-30). Deliberately separate from zendesk_group_departments /
-- departments: adding מובילים or סניפים there would add tabs to the WA
-- dashboards and options to user management. This table only labels.
create table public.zendesk_group_labels (
  group_id text primary key,
  name text not null,
  transfer_bucket text not null check (
    transfer_bucket in ('service', 'deliveries', 'movers', 'branches', 'other')
  )
);

insert into public.zendesk_group_labels (group_id, name, transfer_bucket) values
  ('47486554986641', 'שירות', 'service'),
  ('48454271689489', 'מנהלות שירות', 'service'),
  ('44122190929553', 'אספקות', 'deliveries'),
  ('48792557276433', 'מנהלות אספקות', 'deliveries'),
  ('49034357655825', 'מובילים', 'movers'),
  ('49034391920401', 'סניפים', 'branches'),
  ('49034365175185', 'רכש', 'other'),
  ('49213553402385', 'שימור', 'other'),
  ('48191519984017', 'מנהלים', 'other');

alter table public.zendesk_group_labels enable row level security;
create policy "read zendesk group labels"
  on public.zendesk_group_labels for select to authenticated using (true);

alter table public.sales_service_transfers
  add column assignee_at_transfer text,
  add column waiting_since timestamptz,
  add column queue_wait_seconds integer,
  add column agent_wait_seconds integer;

drop function if exists public.classify_sales_service_transfer(text, timestamptz);

create function public.classify_sales_service_transfer(
  p_phone9 text,
  p_at timestamptz
)
returns table (
  category text,
  ticket_id text,
  ticket_department text,
  last_customer_message_at timestamptz,
  last_agent_message_at timestamptz,
  called_service_line_before boolean,
  called_deliveries_24h boolean,
  assignee_at_transfer text,
  waiting_since timestamptz,
  queue_wait_seconds integer,
  agent_wait_seconds integer
)
language plpgsql
stable
set search_path = public
as $$
#variable_conflict use_column
declare
  r record;
  v_group text;
  v_dept text;
  v_open boolean;
  v_lc timestamptz;
  v_la timestamptz;
  v_rank integer;
  v_activity timestamptz;
  b_id text;
  b_group text;
  b_rank integer := 99;
  b_activity timestamptz;
  b_lc timestamptz;
  b_la timestamptz;
  o_id text;
  o_group text;
  o_activity timestamptz;
  v_svc boolean;
  v_deliv boolean;
  v_ticket text;
  v_ticket_group text;
  v_cat text;
  v_assignee text;
  v_assigned_at timestamptz;
  v_name text;
  v_wait timestamptz;
  v_entered timestamptz;
  v_schedule jsonb;
  v_queue integer;
  v_agent integer;
begin
  for r in
    select zt.id, zt.group_id, zt.zendesk_created_at, zt.solved_at
    from public.zendesk_tickets zt
    where zt.via_channel = 'whatsapp'
      and zt.last_customer_message_at is not null
      and zt.requester_phone is not null
      and right(regexp_replace(zt.requester_phone, '\D', '', 'g'), 9) = p_phone9
      and zt.zendesk_created_at <= p_at
  loop
    v_group := null;
    select tr.value into v_group
    from public.zendesk_ticket_transitions tr
    where tr.ticket_id = r.id and tr.kind = 'group' and tr.at <= p_at
    order by tr.at desc
    limit 1;
    v_group := coalesce(nullif(v_group, ''), r.group_id);
    v_dept := (select gd.department_id from public.zendesk_group_departments gd where gd.group_id = v_group);
    v_open := r.solved_at is null or r.solved_at > p_at;

    select
      max(m.at) filter (where m.direction = 'customer'),
      max(m.at) filter (where m.direction = 'agent')
    into v_lc, v_la
    from public.zendesk_whatsapp_messages m
    where m.ticket_id = r.id and m.at <= p_at;
    v_activity := greatest(
      coalesce(v_lc, '-infinity'::timestamptz),
      coalesce(v_la, '-infinity'::timestamptz),
      r.zendesk_created_at
    );

    if v_dept is distinct from 'customer-service' then
      if v_open and (o_id is null or v_activity > o_activity) then
        o_id := r.id;
        o_group := v_group;
        o_activity := v_activity;
      end if;
      continue;
    end if;

    v_rank := case
      when v_open and v_lc is not null and (v_la is null or v_lc > v_la) then 10
      when v_open then 20
      when r.solved_at >= p_at - interval '7 days' then 30
      else 50
    end;
    if v_rank < b_rank or (v_rank = b_rank and v_activity > b_activity) then
      b_id := r.id;
      b_group := v_group;
      b_rank := v_rank;
      b_activity := v_activity;
      b_lc := v_lc;
      b_la := v_la;
    end if;
  end loop;

  v_svc := exists (
    select 1 from public.calls c
    where c.direction = 'inbound'
      and c.department_id = 'customer-service'
      and c.customer_number is not null
      and c.started_at between p_at - interval '10 minutes' and p_at
      and right(regexp_replace(c.customer_number, '\D', '', 'g'), 9) = p_phone9
      and not exists (
        select 1 from public.sales_service_transfers s
        where s.phone9 = p_phone9
          and c.started_at between s.transferred_at and s.transferred_at + interval '15 seconds'
      )
  );
  v_deliv := exists (
    select 1 from public.calls c
    where c.direction = 'inbound'
      and c.department_id = 'deliveries'
      and c.customer_number is not null
      and c.started_at between p_at - interval '24 hours' and p_at
      and right(regexp_replace(c.customer_number, '\D', '', 'g'), 9) = p_phone9
  );

  if b_rank <= 20 then
    v_ticket := b_id;
    v_ticket_group := b_group;
    v_cat := case when b_rank = 10 then 'waiting' else 'in_progress' end;
  elsif o_id is not null then
    v_ticket := o_id;
    v_ticket_group := o_group;
    v_cat := case (
      select l.transfer_bucket from public.zendesk_group_labels l where l.group_id = o_group
    )
      when 'deliveries' then 'open_deliveries'
      when 'movers' then 'open_movers'
      when 'branches' then 'open_branches'
      else 'other_department'
    end;
  elsif b_rank = 30 then
    v_ticket := b_id;
    v_ticket_group := b_group;
    v_cat := 'recently_solved';
  elsif v_svc then
    v_cat := 'called_service_line';
  elsif b_rank = 50 then
    v_ticket := b_id;
    v_ticket_group := b_group;
    v_cat := 'old_history';
  else
    v_cat := 'no_history';
  end if;

  if v_ticket is not null then
    select tr.value, tr.at into v_assignee, v_assigned_at
    from public.zendesk_ticket_transitions tr
    where tr.ticket_id = v_ticket and tr.kind = 'assignee' and tr.at <= p_at
    order by tr.at desc
    limit 1;
    if v_assignee in ('', '0') then
      v_assignee := null;
      v_assigned_at := null;
    end if;
    if v_assignee is not null then
      select zt2.assignee_name into v_name
      from public.zendesk_tickets zt2
      where zt2.assignee_id = v_assignee and zt2.assignee_name is not null
      limit 1;
    end if;
  end if;

  if v_cat = 'waiting' then
    select min(m.at) into v_wait
    from public.zendesk_whatsapp_messages m
    where m.ticket_id = v_ticket
      and m.direction in ('customer', 'handoff')
      and m.at <= p_at
      and (b_la is null or m.at > b_la);
    select max(tr.at) into v_entered
    from public.zendesk_ticket_transitions tr
    join public.zendesk_group_departments gd on gd.group_id = tr.value
    where tr.ticket_id = v_ticket
      and tr.kind = 'group'
      and tr.at <= p_at
      and gd.department_id = 'customer-service';
    v_wait := greatest(v_wait, v_entered);
    v_schedule := (
      select dbh.schedule from public.department_business_hours dbh
      where dbh.department_id = 'customer-service'
    );

    if v_assignee is null then
      v_cat := 'waiting_assignment';
      v_queue := public.business_seconds(v_wait, p_at, v_schedule);
    else
      v_cat := 'waiting_agent';
      if v_assigned_at <= v_wait then
        v_queue := 0;
        v_agent := public.business_seconds(v_wait, p_at, v_schedule);
      else
        v_queue := public.business_seconds(v_wait, v_assigned_at, v_schedule);
        v_agent := public.business_seconds(v_assigned_at, p_at, v_schedule);
      end if;
    end if;
  end if;

  return query
  select
    v_cat,
    v_ticket,
    coalesce(
      (select d.name from public.zendesk_group_departments gd
         join public.departments d on d.id = gd.department_id
       where gd.group_id = v_ticket_group),
      (select l.name from public.zendesk_group_labels l where l.group_id = v_ticket_group)
    ),
    case when v_cat in ('waiting_assignment', 'waiting_agent', 'in_progress') then b_lc end,
    case when v_cat in ('waiting_assignment', 'waiting_agent', 'in_progress') then b_la end,
    v_svc,
    v_deliv,
    v_name,
    v_wait,
    v_queue,
    v_agent;
end;
$$;

create or replace function public.apply_sales_service_transfer_classification(
  p_id text,
  p_finalize boolean
)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_row public.sales_service_transfers;
  v_cls record;
begin
  select * into v_row from public.sales_service_transfers where id = p_id;
  if not found then
    return;
  end if;

  select * into v_cls
  from public.classify_sales_service_transfer(v_row.phone9, v_row.transferred_at);

  update public.sales_service_transfers t
  set
    category = v_cls.category,
    ticket_id = v_cls.ticket_id,
    ticket_department = v_cls.ticket_department,
    last_customer_message_at = v_cls.last_customer_message_at,
    last_agent_message_at = v_cls.last_agent_message_at,
    called_service_line_before = v_cls.called_service_line_before,
    called_deliveries_24h = v_cls.called_deliveries_24h,
    assignee_at_transfer = v_cls.assignee_at_transfer,
    waiting_since = v_cls.waiting_since,
    queue_wait_seconds = v_cls.queue_wait_seconds,
    agent_wait_seconds = v_cls.agent_wait_seconds,
    is_repeat = exists (
      select 1 from public.sales_service_transfers p
      where p.phone9 = v_row.phone9
        and p.id <> v_row.id
        and p.transferred_at >= v_row.transferred_at - interval '30 minutes'
        and p.transferred_at < v_row.transferred_at
    ),
    classified_at = now(),
    finalized = p_finalize
  where t.id = p_id;
end;
$$;

drop function if exists public.sales_transfers_between(timestamptz, timestamptz, text[]);

create function public.sales_transfers_between(
  p_from timestamptz,
  p_to timestamptz,
  p_excluded_agents text[] default '{}'
)
returns table (
  id text,
  phone text,
  sales_agent text,
  transferred_at timestamptz,
  is_repeat boolean,
  category text,
  ticket_id text,
  ticket_department text,
  ticket_status text,
  ticket_agent_name text,
  assignee_at_transfer text,
  waiting_since timestamptz,
  queue_wait_seconds integer,
  agent_wait_seconds integer,
  customer_name text,
  last_customer_message_at timestamptz,
  last_agent_message_at timestamptz,
  called_service_line_before boolean,
  called_deliveries_24h boolean,
  wa_after_ticket_id text,
  wa_after_at timestamptz
)
language sql
stable
set search_path = public
as $$
  select
    t.id,
    t.phone,
    t.sales_agent,
    t.transferred_at,
    t.is_repeat,
    t.category,
    t.ticket_id,
    t.ticket_department,
    zt.status,
    coalesce(a.name, zt.assignee_name),
    t.assignee_at_transfer,
    t.waiting_since,
    t.queue_wait_seconds,
    t.agent_wait_seconds,
    coalesce(zt.requester_name, after_tk.requester_name),
    t.last_customer_message_at,
    t.last_agent_message_at,
    t.called_service_line_before,
    t.called_deliveries_24h,
    after_tk.id,
    after_tk.zendesk_created_at
  from public.sales_service_transfers t
  left join public.zendesk_tickets zt on zt.id = t.ticket_id
  left join public.agents a on a.id = zt.agent_id
  left join lateral (
    select z.id, z.zendesk_created_at, z.requester_name
    from public.zendesk_tickets z
    where z.via_channel = 'whatsapp'
      and z.last_customer_message_at is not null
      and z.requester_phone is not null
      and z.zendesk_created_at > t.transferred_at
      and z.zendesk_created_at <= t.transferred_at + interval '12 hours'
      and right(regexp_replace(z.requester_phone, '\D', '', 'g'), 9) = t.phone9
    order by z.zendesk_created_at
    limit 1
  ) after_tk on true
  where t.transferred_at >= p_from
    and t.transferred_at <= p_to
    and not (coalesce(t.sales_agent, '') = any (p_excluded_agents))
  order by t.transferred_at desc;
$$;

revoke all on function public.classify_sales_service_transfer(text, timestamptz) from public, anon, authenticated;
revoke all on function public.sales_transfers_between(timestamptz, timestamptz, text[]) from public, anon;
grant execute on function public.sales_transfers_between(timestamptz, timestamptz, text[]) to authenticated;

-- Old 'waiting_on_us' rows would violate the new list: clear every
-- category and let the finalize cron re-classify everything (300/min).
update public.sales_service_transfers
set category = null, finalized = false;

alter table public.sales_service_transfers
  drop constraint sales_service_transfers_category_check;
alter table public.sales_service_transfers
  add constraint sales_service_transfers_category_check check (
    category is null or category in (
      'waiting_assignment', 'waiting_agent', 'in_progress',
      'open_deliveries', 'open_movers', 'open_branches', 'other_department',
      'recently_solved', 'called_service_line', 'old_history', 'no_history'
    )
  );
