-- Applied to the CRM-RC project (nwurpaoflarjwcgpdmew), NOT this project.
-- Kept here for the record: it is the other half of the City Live
-- "העברות מהמכירות" page (sales-transfer-webhook in dashboard-zendesk).
--
-- The shared secret was stored separately (not in migration history):
--   select vault.create_secret('<value of sales_transfer_secret in dashboard-zendesk>',
--                              'city_live_sales_transfer_secret');
--
-- Never allowed to fail the insert: call_logs is fed live by the CallMarker
-- webhook, and a failing trigger would drop CallMarker events.
create or replace function public.notify_city_live_sales_transfer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform net.http_post(
      url := 'https://whshmunahkugkmgxkvvw.supabase.co/functions/v1/sales-transfer-webhook',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-transfer-secret', (
          select decrypted_secret from vault.decrypted_secrets
          where name = 'city_live_sales_transfer_secret' limit 1
        )
      ),
      body := jsonb_build_object(
        'id', new.id,
        'phone', new.phone,
        'agent_name', new.agent_name,
        'direction', new.direction,
        'created_at', new.created_at
      )
    );
  exception when others then
    raise warning 'notify_city_live_sales_transfer failed: %', sqlerrm;
  end;
  return null;
end;
$$;

revoke all on function public.notify_city_live_sales_transfer() from public, anon, authenticated;

create trigger call_logs_notify_city_live_sales_transfer
  after insert on public.call_logs
  for each row
  when (new.direction = 'שיחה שהועברה' and new.phone is not null)
  execute function public.notify_city_live_sales_transfer();
