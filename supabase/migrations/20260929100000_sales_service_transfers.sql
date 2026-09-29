-- Service calls the national SALES centre had to transfer on to service
-- (CallMarker `call_logs.direction = 'שיחה שהועברה'` in the CRM-RC project,
-- pushed here one row at a time by a trigger over there). Each transfer is
-- stamped with what the customer's state was with us at that moment, so the
-- page can show WHY service customers keep reaching sales.
--
-- Additive only: a new table and new functions. Nothing existing changes.

create table public.sales_service_transfers (
  id text primary key,                       -- call_logs.id in CRM-RC
  phone text not null,
  phone9 text not null,                      -- last 9 digits, the cross-system key
  sales_agent text,
  transferred_at timestamptz not null,
  is_repeat boolean not null default false,  -- same phone transferred <30 min earlier
  category text,
  ticket_id text,
  ticket_department text,
  last_customer_message_at timestamptz,
  last_agent_message_at timestamptz,
  called_service_line_before boolean,
  called_deliveries_24h boolean,
  classified_at timestamptz,
  finalized boolean not null default false,
  received_at timestamptz not null default now(),
  constraint sales_service_transfers_category_check check (
    category is null or category in (
      'waiting_on_us', 'in_progress', 'recently_solved',
      'called_service_line', 'old_history', 'no_history'
    )
  )
);

create index sales_service_transfers_at_idx
  on public.sales_service_transfers (transferred_at desc);
create index sales_service_transfers_phone_idx
  on public.sales_service_transfers (phone9, transferred_at);
create index sales_service_transfers_pending_idx
  on public.sales_service_transfers (transferred_at) where not finalized;

alter table public.sales_service_transfers enable row level security;

create policy "read sales service transfers"
  on public.sales_service_transfers
  for select to authenticated
  using (
    (select public.is_admin())
    or (select private.current_department_id()) is null
    or (select private.current_department_id()) = 'customer-service'
  );

-- The customer's state with us at p_at, reconstructed from message
-- timestamps so it does not matter when it is evaluated. Priority order:
-- an open WhatsApp ticket where the customer wrote last beats one where we
-- answered last, beats a ticket solved in the past week, beats a call to the
-- (unanswered) service line in the 10 minutes before, beats older history.
create or replace function public.classify_sales_service_transfer(
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
  called_deliveries_24h boolean
)
language sql
stable
set search_path = public
as $$
  with tk as (
    select
      zt.id,
      zt.group_id,
      zt.zendesk_created_at,
      zt.solved_at,
      (select max(m.at) from public.zendesk_whatsapp_messages m
        where m.ticket_id = zt.id and m.direction = 'customer' and m.at <= p_at) as lc,
      (select max(m.at) from public.zendesk_whatsapp_messages m
        where m.ticket_id = zt.id and m.direction = 'agent' and m.at <= p_at) as la
    from public.zendesk_tickets zt
    where zt.via_channel = 'whatsapp'
      and zt.last_customer_message_at is not null
      and zt.requester_phone is not null
      and right(regexp_replace(zt.requester_phone, '\D', '', 'g'), 9) = p_phone9
      and zt.zendesk_created_at <= p_at
  ),
  ranked as (
    select
      tk.*,
      case
        when (tk.solved_at is null or tk.solved_at > p_at)
          and tk.lc is not null and (tk.la is null or tk.lc > tk.la) then 1
        when (tk.solved_at is null or tk.solved_at > p_at) then 2
        when tk.solved_at >= p_at - interval '7 days' then 3
        else 5
      end as rank
    from tk
  ),
  best as (
    select *
    from ranked
    order by
      rank,
      greatest(
        coalesce(lc, '-infinity'::timestamptz),
        coalesce(la, '-infinity'::timestamptz),
        zendesk_created_at
      ) desc
    limit 1
  ),
  flags as (
    select
      exists (
        select 1 from public.calls c
        where c.direction = 'inbound'
          and c.department_id = 'customer-service'
          and c.customer_number is not null
          and c.started_at between p_at - interval '10 minutes' and p_at
          and right(regexp_replace(c.customer_number, '\D', '', 'g'), 9) = p_phone9
      ) as svc,
      exists (
        select 1 from public.calls c
        where c.direction = 'inbound'
          and c.department_id = 'deliveries'
          and c.customer_number is not null
          and c.started_at between p_at - interval '24 hours' and p_at
          and right(regexp_replace(c.customer_number, '\D', '', 'g'), 9) = p_phone9
      ) as deliv
  )
  select
    case
      when b.rank = 1 then 'waiting_on_us'
      when b.rank = 2 then 'in_progress'
      when b.rank = 3 then 'recently_solved'
      when f.svc then 'called_service_line'
      when b.rank = 5 then 'old_history'
      else 'no_history'
    end,
    b.id,
    d.name,
    b.lc,
    b.la,
    f.svc,
    f.deliv
  from flags f
  left join best b on true
  left join public.zendesk_group_departments gd on gd.group_id = b.group_id
  left join public.departments d on d.id = gd.department_id;
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

-- Called by the sales-transfer-webhook edge function for every new row.
-- Idempotent on the CRM-RC row id. The first classification is provisional:
-- the Zendesk sync can lag ~30-60s behind a message the customer just sent.
create or replace function public.ingest_sales_service_transfer(
  p_id text,
  p_phone text,
  p_agent text,
  p_at timestamptz
)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_phone9 text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 9);
  v_agent text := nullif(trim(p_agent), '');
begin
  if v_phone9 = '' or p_at is null then
    return;
  end if;
  -- Same account, older CallMarker display name.
  if v_agent = 'יהב' then
    v_agent := 'יהב כ';
  end if;

  insert into public.sales_service_transfers (id, phone, phone9, sales_agent, transferred_at)
  values (p_id, p_phone, v_phone9, v_agent, p_at)
  on conflict (id) do nothing;

  perform public.apply_sales_service_transfer_classification(p_id, false);
end;
$$;

-- Re-run once the Zendesk/Aircall syncs have caught up, then freeze.
create or replace function public.finalize_sales_service_transfers(p_limit integer default 300)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_id text;
  v_count integer := 0;
begin
  for v_id in
    select id from public.sales_service_transfers
    where not finalized and transferred_at < now() - interval '3 minutes'
    order by transferred_at
    limit p_limit
  loop
    perform public.apply_sales_service_transfer_classification(v_id, true);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- One day's transfers for the page, with the linked ticket's CURRENT state
-- and whether the customer opened a WhatsApp conversation within 12h after.
-- SECURITY INVOKER: RLS on every table applies to the caller.
create or replace function public.sales_transfers_between(
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
    coalesce(zt.requester_name, after_tk.requester_name),
    t.last_customer_message_at,
    t.last_agent_message_at,
    t.called_service_line_before,
    t.called_deliveries_24h,
    after_tk.id,
    after_tk.zendesk_created_at
  from public.sales_service_transfers t
  left join public.zendesk_tickets zt on zt.id = t.ticket_id
  left join lateral (
    select a.id, a.zendesk_created_at, a.requester_name
    from public.zendesk_tickets a
    where a.via_channel = 'whatsapp'
      and a.last_customer_message_at is not null
      and a.requester_phone is not null
      and a.zendesk_created_at > t.transferred_at
      and a.zendesk_created_at <= t.transferred_at + interval '12 hours'
      and right(regexp_replace(a.requester_phone, '\D', '', 'g'), 9) = t.phone9
    order by a.zendesk_created_at
    limit 1
  ) after_tk on true
  where t.transferred_at >= p_from
    and t.transferred_at <= p_to
    and not (coalesce(t.sales_agent, '') = any (p_excluded_agents))
  order by t.transferred_at desc;
$$;

-- Daily counts per category for the trend table (repeats within 30 min
-- collapsed into the first transfer).
create or replace function public.sales_transfers_daily(
  p_from timestamptz,
  p_to timestamptz,
  p_excluded_agents text[] default '{}'
)
returns table (
  day date,
  category text,
  transfers integer,
  episodes integer,
  customers integer
)
language sql
stable
set search_path = public
as $$
  select
    (t.transferred_at at time zone 'Asia/Jerusalem')::date as day,
    t.category,
    count(*)::integer,
    count(*) filter (where not t.is_repeat)::integer,
    count(distinct t.phone9)::integer
  from public.sales_service_transfers t
  where t.transferred_at >= p_from
    and t.transferred_at <= p_to
    and not (coalesce(t.sales_agent, '') = any (p_excluded_agents))
  group by 1, 2
  order by 1, 2;
$$;

revoke all on function public.classify_sales_service_transfer(text, timestamptz) from public, anon, authenticated;
revoke all on function public.apply_sales_service_transfer_classification(text, boolean) from public, anon, authenticated;
revoke all on function public.ingest_sales_service_transfer(text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.finalize_sales_service_transfers(integer) from public, anon, authenticated;
grant execute on function public.ingest_sales_service_transfer(text, text, text, timestamptz) to service_role;
grant execute on function public.finalize_sales_service_transfers(integer) to service_role;

revoke all on function public.sales_transfers_between(timestamptz, timestamptz, text[]) from public, anon;
revoke all on function public.sales_transfers_daily(timestamptz, timestamptz, text[]) from public, anon;
grant execute on function public.sales_transfers_between(timestamptz, timestamptz, text[]) to authenticated;
grant execute on function public.sales_transfers_daily(timestamptz, timestamptz, text[]) to authenticated;

-- Dedicated secret for the CRM-RC -> here push (not the shared sync secret,
-- which stays inside this project). Generated here so it never sits in git.
select vault.create_secret(
  replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  'sales_transfer_secret'
)
where not exists (select 1 from vault.secrets where name = 'sales_transfer_secret');

create or replace function public.get_sales_transfer_secret()
returns text
language sql
security definer
set search_path to ''
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = 'sales_transfer_secret'
  limit 1;
$$;

revoke all on function public.get_sales_transfer_secret() from public, anon, authenticated;
grant execute on function public.get_sales_transfer_secret() to service_role;

select cron.schedule(
  'sales-transfer-finalize-every-minute',
  '* * * * *',
  $$select public.finalize_sales_service_transfers(300);$$
);
