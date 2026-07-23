-- Missed-call email notifications: sender settings + recipient list + trigger.
--
-- A call transitioning into status = 'missed' (from aircall-webhook, the
-- stale-call sweeper, or the on-call reconciler — any writer) fires a
-- one-shot async HTTP call to the notify-missed-call edge function, which
-- applies the same short-no-answer threshold used everywhere else in the
-- app before sending.

create table if not exists public.missed_call_notification_settings (
  id smallint primary key default 1,
  from_email text not null default 'rcity@rc-info.org',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint missed_call_notification_settings_singleton check (id = 1)
);

insert into public.missed_call_notification_settings (id, from_email)
values (1, 'rcity@rc-info.org')
on conflict (id) do nothing;

alter table public.missed_call_notification_settings enable row level security;

create policy "admins read missed call notification settings"
  on public.missed_call_notification_settings for select to authenticated
  using (public.is_admin());

create policy "admins write missed call notification settings"
  on public.missed_call_notification_settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

revoke all on table public.missed_call_notification_settings from anon;
grant select, insert, update on table public.missed_call_notification_settings to authenticated;

create table if not exists public.missed_call_notification_recipients (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

alter table public.missed_call_notification_recipients enable row level security;

create policy "admins read missed call notification recipients"
  on public.missed_call_notification_recipients for select to authenticated
  using (public.is_admin());

create policy "admins write missed call notification recipients"
  on public.missed_call_notification_recipients for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

revoke all on table public.missed_call_notification_recipients from anon;
grant select, insert, update, delete on table public.missed_call_notification_recipients to authenticated;

-- Fires once per call, exactly when it newly becomes 'missed' (not on every
-- subsequent unrelated update to an already-missed row).
create or replace function private.notify_missed_call()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'missed'
     and (tg_op = 'INSERT' or old.status is distinct from 'missed') then
    perform net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
        || '/functions/v1/notify-missed-call',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_function_secret')
      ),
      body := jsonb_build_object('callId', new.id)
    );
  end if;
  return new;
end;
$$;

revoke all on function private.notify_missed_call() from public;

drop trigger if exists notify_missed_call_trigger on public.calls;
create trigger notify_missed_call_trigger
  after insert or update on public.calls
  for each row
  execute function private.notify_missed_call();
