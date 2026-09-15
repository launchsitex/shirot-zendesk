-- Track the Priority sales agent separately from the branch, for analysis
-- only (the customer-facing survey still asks one combined "מוכר/סניף"
-- score — this does not add a 4th question, just a metadata column so the
-- dashboard can later break the branch score down by agent).

alter table public.survey_pending_sends add column if not exists agent_name text;
alter table public.survey_responses add column if not exists agent_name text;

create index if not exists survey_responses_agent_idx on public.survey_responses (agent_name);
