-- Same manual, per-ticket anomaly exclusion as 20260922160000 — the pattern
-- recurred on 2026-09-23: 8 more שירות-לקוחות tickets sat fully unassigned
-- 4-7 hours despite near-instant pickup (9-29 min) on every other ticket
-- that day, again found and picked up only in one manual sweep
-- (14:56-15:06). Confirmed with the account owner before excluding.
update public.zendesk_tickets
set excluded_from_wa_averages = true,
    excluded_from_wa_averages_reason = 'לא נותב/הוצע לאף נציגה - נתפס רק בסבב ידני, 23.09.2026'
where id in ('82582','82636','82697','82728','82798','83008','83062','83114');
