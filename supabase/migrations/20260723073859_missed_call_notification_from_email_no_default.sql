-- The 20260723073102 migration seeded from_email with a literal address as
-- a bootstrap default. The address must live only in the settings row (set
-- via the Settings UI), never as a code fallback -- drop the column default
-- so any future environment starts unconfigured instead of inheriting it.
alter table public.missed_call_notification_settings
  alter column from_email drop not null,
  alter column from_email drop default;
