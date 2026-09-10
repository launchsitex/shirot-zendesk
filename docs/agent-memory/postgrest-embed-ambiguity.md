---
name: postgrest-embed-ambiguity
description: Any new table with FKs to two existing tables makes PostgREST treat it as a junction and breaks every unhinted embed between them (300 / PGRST201) — hint the FK column in every select
metadata: 
  node_type: memory
  type: project
  originSessionId: 0c026c3e-a01c-4010-814d-179343d3079d
  modified: 2026-09-09T11:18:21.385Z
---

Adding a table that references two existing tables (e.g. `wa_agent_daily` with `agent_id → agents` and `department_id → departments`, applied 2026-09-09) makes PostgREST see a second, many-to-many path between those tables. Every existing `agents(... departments(...))` embed then answers HTTP 300 `PGRST201` and the Next.js API routes return 500 with no body — the whole dashboard goes blank right after a deploy that looked unrelated. Same thing happened earlier with `agents!agent_id` after adding `first_response_agent_id` / `solved_by_agent_id` FKs on `zendesk_tickets`.

**Why:** PostgREST auto-detects junction tables; it does not care that the new table is a rollup, not a relationship.

**How to apply:** before applying any migration that adds a table or FK, grep `src` and `supabase/functions` for `select(` embeds touching the affected tables and hint them (`departments!department_id(...)`, `agents!agent_id(...)`). After applying, confirm with an anon-key curl against `/rest/v1/<table>?select=...` (300 vs 200 shows the ambiguity even without RLS access), and check Supabase `edge_logs` for `response.status_code = 300` with user agent `node`. See [[hosting-deploy-reality]] for the deploy timing.
