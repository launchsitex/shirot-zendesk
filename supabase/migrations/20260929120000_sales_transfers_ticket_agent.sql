-- "העברות מהמכירות": show which agent the linked ticket is with (its
-- CURRENT assignee). The return type changes, so drop and recreate.
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

revoke all on function public.sales_transfers_between(timestamptz, timestamptz, text[]) from public, anon;
grant execute on function public.sales_transfers_between(timestamptz, timestamptz, text[]) to authenticated;
