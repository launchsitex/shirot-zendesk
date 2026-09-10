---
name: rls-department-hardening
description: "Department-scoped RLS applied to live Supabase 2026-07-30 (migration 20260730200000) — verified, no leaks; queue_snapshots/zendesk_customers still open"
metadata: 
  node_type: memory
  type: project
  originSessionId: 129a8761-8a7c-46b4-b284-caefc0d8abb1
  modified: 2026-07-30T13:57:50.399Z
---

Known security gap (from the 2026-07 comprehensive review): 11 public tables have `SELECT to authenticated using(true)` — incl. `calls` (customer phone numbers), `call_recordings`, `call_legs`, `agents`, `agent_live_status`, `agent_status_history`. Department isolation lives only in the Next.js API (`src/lib/auth/department-scope.ts`) and is bypassable from the browser via PostgREST with the user's own JWT.

**Why:** RLS was seeded permissive; scoping was added later only in API code.

**How to apply:** RESOLVED — migration `supabase/migrations/20260730200000_department_scoped_rls.sql` was **applied to live Supabase on 2026-07-30** (user-approved, via MCP `apply_migration`, name `department_scoped_rls`): admin OR profile-without-department → full read; department-scoped profile → own department rows only (children delegate via EXISTS to parent `calls`/`agents`). Verified by SQL role simulation: scoped viewer saw exactly their department (0 leaks), admin/manager saw all; month-range page query 68ms (policies run as InitPlans). `list_call_recordings_page` is SECURITY INVOKER so it inherits the policies; Edge Functions (service_role) unaffected. Still open: `queue_snapshots`, `zendesk_customers` (also hold caller numbers).
