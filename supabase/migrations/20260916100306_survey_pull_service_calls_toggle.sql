-- Lets each Priority pull-request choose whether to include service/repair
-- branches (BRANCHNAME in the "service" set: 10,11,12,13,14,16,17,18,19,23,24)
-- or exclude them (default). Added after discovering service-branch orders
-- (e.g. SO26-S005788, a parts/repair order) were leaking into the survey
-- queue because the old filter only checked the customer's home branch
-- (CUSTNAME), not the branch that actually handled the transaction
-- (BRANCHNAME). See CHANGELOG.md 2026-09-16.
alter table public.survey_priority_pull_requests
  add column if not exists include_service_calls boolean not null default false;
