# PROJECT_CONTEXT — City Live / רהיטי הסיטי

Living document for agents and developers. Update this file when architecture, integrations, or status rules change.

## Product

- **Name:** City Live (דשבורד Aircall)
- **Customer:** רהיטי הסיטי — מחלקות **שירות לקוחות** ו**אספקות**
- **Purpose:** Hebrew RTL live call-center monitoring: agent presence, waiting queue, active calls, KPIs, recordings, analytics, status duration reports
- **Repo:** https://github.com/launchsitex/shirot-zendesk (`main`)
- **UI language:** Hebrew, RTL (`Asia/Jerusalem` display; DB timestamps UTC)

## Stack

| Layer | Tech |
| --- | --- |
| App | Next.js 16 (App Router), React 19, TypeScript, Tailwind 4 |
| Auth / DB | Supabase Auth + Postgres + Realtime + RLS |
| Telephony | **Aircall** (primary live source via webhooks + Users API) |
| AI | Gemini (Edge Function `analyze-recording`) behind feature flag `ai_call_analysis` |
| Hosting | Node Next.js host (e.g. Vercel / Hostinger Node) — not static |

**Supabase project ref (production):** `whshmunahkugkmgxkvvw`

## App routes (pages)

| Path | Role |
| --- | --- |
| `/dashboard` | Main ops dashboard |
| `/wallboard` | Full-screen wallboard (agent status, waiting, active calls) |
| `/calls` | Call history |
| `/agents` | Agents |
| `/analytics` | Analytics / KPIs / Excel export |
| `/after-hours` | After-hours routing / business hours |
| `/recordings` | Recordings player (paginated RPC) |
| `/ai-analysis` | AI call analysis (admin + feature flag) |
| `/status-report` | Agent status duration + “Next status” |
| `/settings` | Integrations, webhook URL, flags |
| `/users` | User management (admin) |
| `/system-logs` | System event logs |
| `/login` | Auth |

## Data flow (Aircall → UI)

```
Aircall events
  → Edge `aircall-webhook` (custom key auth, verify_jwt=false)
  → tables: calls, agents, agent_live_status, agent_status_history, call_recordings, …
  → Next.js `/api/dashboard` (+ clients)
  → Wallboard / Dashboard UI
```

Roster availability is also refreshed by Edge `sync-aircall-users` (Aircall Users API).

### Critical status rules (do not regress)

1. **Source of truth for Away presence** (Back office, break, lunch, training, other, unavailable): Aircall user/availability events. When these arrive, **close phantom `in_progress` calls** for that agent and trust the presence state.
2. **Do not force UI `on_call`** over Away / wrap_up just because an `in_progress` row exists. Dashboard only forces `on_call` when live state is `available` or `scheduled` **and** there is an open call (roster sync can wipe true on-call to “available”).
3. **`call.external_transferred`:** treat as finished for the transferring agent (they are free in Aircall even if hungup is late/missing).
4. **Internal `call.transferred`:** move `agent_id` to `transferred_to`; update transferring agent availability.
5. Stuck `in_progress` rows after transfer/missed hungup historically showed false **בשיחה** (e.g. דניאל גואטה) while Aircall showed Back office.

Relevant code:

- `supabase/functions/aircall-webhook/index.ts`
- `supabase/functions/sync-aircall-users/index.ts`
- `src/app/api/dashboard/route.ts`
- `src/components/wallboard-client.tsx`
- Migration: `supabase/migrations/20260721120000_close_stale_calls_respect_away_presence.sql`

### Agent states (`src/lib/types.ts`)

`available` | `ringing` | `on_call` | `wrap_up` | `scheduled` | `out_for_lunch` | `on_break` | `in_training` | `back_office` | `other` | `unavailable`

Hebrew labels live in `src/lib/israel-time.ts` (or related helpers). Wrap-up = After Call Work / סטטוס הבא from next history segment.

## Key Supabase tables / concepts

- `calls` — live + history; `status`: `in_progress` | `answered` | `missed`
- `agent_live_status` — current presence for wallboard
- `agent_status_history` — duration / status report
- `agents`, `departments`, `department_lines`, `department_groups`
- `call_recordings` — URLs expire (S3); refresh via Aircall API on 403 (`_shared/recordings.ts`)
- `aircall_webhook_events` — idempotent delivery (hash)
- `system_event_logs` — operational errors/warnings
- Feature flags in settings (e.g. `ai_call_analysis`)

## Edge functions

| Function | JWT | Notes |
| --- | --- | --- |
| `aircall-webhook` | off | Custom webhook key; call + user events |
| `sync-aircall-users` | off | Roster / Away sync; sync secret header |
| `stream-recording` | off | Authenticated stream + URL refresh |
| `analyze-recording` | off | Gemini analysis |
| `admin-users` | on | User CRUD via service role |
| `sync-live` / `sync-history` / `sync-recordings` | off | Legacy/Zendesk-era sync helpers (Talk path largely replaced by Aircall) |

Deploy via Supabase MCP or CLI with project access. Local CLI may 403 if the logged-in org lacks privileges on this project — use MCP `deploy_edge_function` then.

## Auth & roles

- Supabase Auth; first user → `admin`, others default `viewer`
- Roles: `admin` / `manager` / `viewer` (+ department scoping for some users)
- Service role stays on Edge Functions — **not** in Next.js env for user admin

## Env (Next.js)

See `.env.example`:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_DEMO_MODE` (`true` = mock data)

Never commit `.env.local`.

## Departments

Seeded: **שירות לקוחות**, **אספקות**. Mapping from Aircall Teams / lines (`department_groups`, `department_lines`). Business hours / after-hours routing supported.

## Conventions for agents

- Prefer existing patterns; Hebrew UI copy; RTL-aware layout
- Do not commit auto-touched `next-env.d.ts` unless intentional
- Commit/push only when the user asks; prefer `main` when they request production deploy
- When fixing live status bugs: inspect `agent_live_status` **and** open `calls` rows together — UI bugs are often stale `in_progress`, not wrong live state
- Keep `PROJECT_CONTEXT.md` updated after meaningful product/architecture changes

## Local commands

```bash
npm install
copy .env.example .env.local
npm run dev
npm run lint && npm run typecheck && npm test && npm run build
```

## Recent production fixes (2026-07)

- Force `on_call` when open call + live `available` (roster wipe)
- Close stale calls / respect Away presence so Back office is not shown as בשיחה
- Recordings pagination RPC; Aircall recording URL refresh on 403
- Gemini AI analysis behind admin feature flag
