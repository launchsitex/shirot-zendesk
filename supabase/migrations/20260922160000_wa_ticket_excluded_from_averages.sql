-- Manual, per-ticket exclusion from WA response-time averages (not from
-- ticket/closed counts) — for a ticket the account owner has confirmed is a
-- genuine anomaly (e.g. never routed/offered to any agent, so no agent's
-- number should absorb its wait), not a general auto-threshold rule: he
-- wants to review each case himself, 2026-09-22.
alter table public.zendesk_tickets
  add column if not exists excluded_from_wa_averages boolean not null default false,
  add column if not exists excluded_from_wa_averages_reason text;

-- First use: 13 שירות-לקוחות tickets from 2026-09-22 that sat fully
-- unassigned for 3-8 hours despite near-instant pickup on every other
-- ticket that day (median well under a minute) — never routed/offered to
-- an agent, only found and picked up in two manual sweeps (13:32-13:35,
-- 14:29-14:56). Confirmed with the account owner before excluding.
update public.zendesk_tickets
set excluded_from_wa_averages = true,
    excluded_from_wa_averages_reason = 'לא נותב/הוצע לאף נציגה - נתפס רק בסבב ידני, 22.09.2026'
where id in ('80818','80819','80821','80832','80876','80897','80960','80967','80963','80988','81062','81085','81117');
