-- Global admin-configurable threshold (seconds) below which a missed inbound
-- call is classified as "short no-answer" for display/reporting purposes.
-- Purely a display-time reclassification: the underlying calls.status stays
-- "missed" and no historical data is touched.

create table if not exists public.missed_call_settings (
  id smallint primary key default 1,
  short_no_answer_threshold_seconds integer not null default 60,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint missed_call_settings_singleton check (id = 1),
  constraint missed_call_settings_threshold_range
    check (short_no_answer_threshold_seconds between 0 and 3600)
);

comment on table public.missed_call_settings is
  'Singleton row. short_no_answer_threshold_seconds gates which missed inbound calls display as "missed_short" instead of "missed".';

insert into public.missed_call_settings (id) values (1) on conflict (id) do nothing;

alter table public.missed_call_settings enable row level security;

drop policy if exists "authenticated read missed call settings" on public.missed_call_settings;
create policy "authenticated read missed call settings"
  on public.missed_call_settings for select to authenticated
  using (true);

drop policy if exists "admins write missed call settings" on public.missed_call_settings;
create policy "admins write missed call settings"
  on public.missed_call_settings for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

revoke all on table public.missed_call_settings from anon;
grant select, insert, update on table public.missed_call_settings to authenticated;
