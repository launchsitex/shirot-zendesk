-- Lets the Priority-pull automation insert rows without generating a UUID
-- client-side; it fills in message_text afterward via an UPDATE that embeds
-- this generated token in the survey link.
alter table public.survey_pending_sends
  alter column token set default gen_random_uuid()::text;
