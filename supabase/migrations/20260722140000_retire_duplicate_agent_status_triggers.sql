-- Root cause of the wallboard "agent status stuck/wrong" bug class: at least
-- three independently-maintained copies of "map Aircall status -> our
-- agent_state" existed (aircall-webhook's mapAvailability, sync-aircall-users'
-- mapState, and this schema's private.aircall_state_from_user), writing to
-- agent_live_status from six different places with no single source of truth.
--
-- The two SQL triggers dropped here are now confirmed dead weight rather than
-- safety nets:
--
-- 1. aircall_user_status_after_processing (-> private.apply_aircall_user_status)
--    fires AFTER UPDATE OF processed on aircall_webhook_events for every
--    user.* event. But aircall-webhook's own processUserEvent() already
--    handles every user.* event synchronously, in the same request, BEFORE
--    `processed` is set to true (an exception skips setting it) — so this
--    trigger only ever fires after a successful TS-side write already ran.
--    It is a pure second write using a separately-maintained, independently
--    drifting copy of the mapping logic (confirmed drift: "custom" mapped to
--    "available" by the TS webhook but "scheduled" by this SQL copy).
--
-- 2. guard_aircall_agent_status_order unconditionally overwrites whatever
--    state aircall-webhook just computed for a call.hungup event, using the
--    MOST RECENTLY CACHED user.* webhook payload as its "better" source of
--    truth — but that cached payload can itself be stale (e.g. the agent
--    changed status mid-call and Aircall didn't send a fresh user.* webhook
--    until after hangup), silently downgrading a fresh, correct write back to
--    a stale value. Its `call.ended` branch is dead code: no writer in the
--    codebase sets zendesk_agent_state to that literal.
--
-- aircall-webhook/index.ts and sync-aircall-users/index.ts now both import
-- ONE canonical mapAvailability() from supabase/functions/_shared/aircall-status.ts,
-- making the TypeScript layer the single source of truth for Aircall status
-- mapping. No data is deleted or rewritten by this migration — only these two
-- trigger/function pairs are removed. The unrelated reconciliation cron
-- (agent-status-reconcile-every-2-minutes) and the /api/dashboard forceOnCall
-- read-time override are untouched — they derive state from active calls,
-- not from Aircall status mapping, and don't participate in this drift.

drop trigger if exists aircall_user_status_after_processing
  on public.aircall_webhook_events;
drop function if exists private.apply_aircall_user_status();

drop trigger if exists guard_aircall_agent_status_order
  on public.agent_live_status;
drop function if exists private.guard_aircall_agent_status_order();

drop function if exists private.aircall_state_from_user(jsonb);
