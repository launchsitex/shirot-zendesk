-- Feature 1: ask 5-star respondents (all three scores = 5) for a Google
-- review, sent directly via InfoU, using a Google review link chosen per
-- SEND BATCH (one branch's link for everyone in that batch, independent of
-- which branch each customer actually bought from — explicit owner
-- decision, not a bug).
create table if not exists public.survey_google_review_links (
  branch_id text primary key references public.survey_branches(id),
  url text not null default '',
  updated_at timestamptz not null default now()
);
comment on table public.survey_google_review_links is 'Google Business review link per physical branch, admin-edited; used for the "ask happy customers for a Google review" send, independent of which branch the recipient actually bought from.';

create trigger survey_google_review_links_set_updated_at before update on public.survey_google_review_links for each row execute function public.set_updated_at();

alter table public.survey_google_review_links enable row level security;
create policy survey_google_review_links_staff_all on public.survey_google_review_links
  for all to authenticated using (true) with check (true);

-- Track whether/when we already asked this respondent for a Google review,
-- so we don't ask the same happy customer twice.
alter table public.survey_responses add column if not exists google_review_requested_at timestamptz;

insert into public.survey_message_template (id, template_text)
values ('google_review', 'תודה {שם_לקוח} על הציון המעולה! נשמח מאוד אם תוכל/י להשאיר לנו כמה מילים בגוגל: {קישור}')
on conflict (id) do nothing;

-- Feature 2: let an admin exclude one response's scores from every average
-- (overall/category/branch/agent/mover) without deleting the row itself —
-- e.g. a data-entry error, or a review about something unrelated to this
-- order's actual service.
alter table public.survey_responses add column if not exists excluded_from_average boolean not null default false;
alter table public.survey_responses add column if not exists excluded_reason text;
