-- OfferedToEvent turned out not to be the bot's handoff: it fires when the
-- routing *offers* the conversation to an available agent, which can be
-- minutes after the bot let go. Ticket 71209 (2026-09-09): the bot cleared
-- its own assignment, set the group and moved status open→new at 08:26:20;
-- OfferedToEvent came at 08:32:47, once an agent had capacity — 6.5 minutes
-- the customer spent in the queue that the dashboard did not show.
--
-- The handoff is therefore the status open→new transition (agents cannot set
-- "new" themselves, so it is only ever the system's). The sync records that
-- as 'handoff' from now on; the rows already stored under 'handoff' were
-- OfferedToEvents and are dropped so min(at) is not skewed by them. Today's
-- events are replayed by rewinding the events cursor.

delete from public.zendesk_whatsapp_messages where direction = 'handoff';

select public.recompute_whatsapp_activity(
  array(select id from public.zendesk_tickets where handed_to_agent_at is not null)
);
