do $$
begin
  if exists (select 1 from cron.job where jobname = 'zendesk-live-every-15-seconds') then
    perform cron.unschedule('zendesk-live-every-15-seconds');
  end if;
  if exists (select 1 from cron.job where jobname = 'zendesk-history-every-minute') then
    perform cron.unschedule('zendesk-history-every-minute');
  end if;
  if exists (select 1 from cron.job where jobname = 'zendesk-recordings-every-5-minutes') then
    perform cron.unschedule('zendesk-recordings-every-5-minutes');
  end if;
  if exists (select 1 from cron.job where jobname = 'zendesk-recordings-every-five-minutes') then
    perform cron.unschedule('zendesk-recordings-every-five-minutes');
  end if;
end;
$$;
