-- The bootstrap seed in 20260723073102 hardcoded a specific customer's
-- sender address into the row. That was a mistake for a multi-tenant
-- codebase: any fresh install must start with no sender configured, forcing
-- each deployment to enter and save its own address via Settings.
update public.missed_call_notification_settings
set from_email = null
where id = 1;
