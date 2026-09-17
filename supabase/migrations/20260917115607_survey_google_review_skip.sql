-- Lets an admin dismiss a 5-star response from the "ask for a Google review"
-- list without actually sending anything — the response stays in the
-- system, just excluded from the not-yet-requested list going forward.
alter table public.survey_responses add column if not exists google_review_skipped_at timestamptz;
