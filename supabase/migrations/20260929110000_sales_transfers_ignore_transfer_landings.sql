-- Every CallMarker transfer lands on the Aircall "שירות" line ~2 seconds
-- later (hears the recorded message, hangs up). So when a customer is
-- transferred twice, the first transfer's landing looked like "called the
-- service line before" for the second. Ignore service-line calls that start
-- within 15s after any transfer of the same phone: those are our own
-- transfers, not the customer dialling service.
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
          and not exists (
            select 1 from public.sales_service_transfers s
            where s.phone9 = p_phone9
              and c.started_at between s.transferred_at and s.transferred_at + interval '15 seconds'
          )
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

revoke all on function public.classify_sales_service_transfer(text, timestamptz) from public, anon, authenticated;
