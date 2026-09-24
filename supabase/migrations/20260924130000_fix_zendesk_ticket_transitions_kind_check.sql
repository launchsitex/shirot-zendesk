-- Urgent fix: 20260924090000's group_id tracking has been failing every
-- sync run since deploy (~3 hours) with "violates check constraint
-- zendesk_ticket_transitions_kind_check" — the constraint only allowed
-- 'status'/'assignee', not the new 'group' kind. Since that upsert throws
-- uncaught inside syncComments (unlike the try/caught availability and
-- custom-status steps after it), it has been silently killing the entire
-- comments/messages/transitions/availability/custom-statuses tail of every
-- sync run — not just the new group tracking. Ticket-level sync itself was
-- unaffected (it commits before this step). Caught via the account owner
-- noticing an agent's live status (on break) was stuck showing online.
alter table public.zendesk_ticket_transitions
  drop constraint zendesk_ticket_transitions_kind_check;

alter table public.zendesk_ticket_transitions
  add constraint zendesk_ticket_transitions_kind_check
  check (kind = any (array['status', 'assignee', 'group']));
