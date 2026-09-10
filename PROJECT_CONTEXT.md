# PROJECT_CONTEXT — City Live / רהיטי הסיטי

Living document for agents and developers. Update this file when architecture, integrations, or status rules change.

**Change log (required on every meaningful change):** see `CHANGELOG.md`. Cursor rule `.cursor/rules/update-changelog.mdc` enforces keeping it current.

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
| AI | Gemini (`analyze-recording`, `analyze-agent-day`) behind feature flag `ai_call_analysis` |
| Hosting | **Hostinger (hPanel) + LiteSpeed** at `31.97.121.216` — Node Next.js on internal port `3000` behind LiteSpeed. Not static, **not Vercel**. |

**Supabase project ref (production):** `whshmunahkugkmgxkvvw`

### Deployment reality (corrected 2026-08-02)

- **Pushing to GitHub `main` DOES deploy.** Production is a Hostinger
  **Web App** with *Connected with GitHub* + *Auto-deployment* enabled
  (repo `shirot-zendesk`, branch `main`, root `./`, Next.js, Node 22.x).
  A push builds and goes live on its own in about a minute — commit
  `e39876dd` deployed at 11:13 in 1m 0s. There is no manual step, no SSH
  and no pm2; it is **not** a VPS.
- An earlier note here claimed the opposite, reasoning that the GitHub repo
  had no webhooks, deploy keys or commit statuses. **That inference was
  wrong** — Hostinger's Web Apps integration does not appear on the repo
  side at all. The authority is the hPanel dashboard's `Last deployment`
  card (state, commit SHA, timestamp, duration).
- **Deploying ≠ clients updating.** Browser tabs that were already open keep
  running the previously served JavaScript until reloaded, so client-side
  changes (polling intervals, Realtime handling) only take effect per tab on
  refresh. After a fix aimed at request volume, tell the office to reload.
- Supabase migrations and Edge Functions deploy **separately** (MCP
  `apply_migration` / `deploy_edge_function`), not via the GitHub push.
- The LiteSpeed layer serves its default `403 Forbidden — "Access to this
  resource on the server is denied!"` page when its anti-flood / per-IP
  protection triggers; this happens **before** the Next.js app.
- **Production URL: `https://zend-shirot.rc-info.org`** (verified 2026-07-30).
  Chain: browser → Hostinger CDN (`Server: hcdn`, 92.113.x) → origin LiteSpeed
  at `31.97.121.216` → Next.js Node on port 3000. Company site `rcity.co.il`
  is a separate property (Cloudflare).
- The 403 users hit is served **per client IP** by LiteSpeed's flood
  protection — the app and both hops stay healthy for everyone else. Unblock
  in hPanel; the durable fix is keeping request volume per IP low (see the
  polling rules in `section-pages.tsx` / `dashboard-client.tsx`).

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
| `/agent-ai-analysis` | Daily agent AI analysis + history (admin + feature flag) |
| `/status-report` | Agent status duration + “Next status” |
| `/ticket-tracking` · `/ticket-tracking/open` | Zendesk ticket documentation tracking; open tickets |
| `/wa-dashboard` | WhatsApp (Zendesk Messaging) dashboard — one day, tabs per department, agent picker |
| `/wa-dashboard/tv?department=…` | WhatsApp wallboard (today only, full screen) |
| `/wa-dashboard/history` | "ביצועי WA" — stored daily record per agent, ranges, previous-period deltas, CSV |
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

## WhatsApp dashboards (Zendesk Messaging) — definitions that pay depends on

Agent pay and bonuses are computed from these figures; every definition below is deliberate and must not drift. Pure logic lives in `src/lib/wa-dashboard.ts` (tested), the per-row mapping in `src/app/api/wa-dashboard/route.ts` (`mapTicketRow`), the stored daily record in `recompute_wa_agent_daily` (SQL, same definitions).

| Figure | Definition |
| --- | --- |
| Day | Israel calendar day the ticket was **opened**; `via_channel = whatsapp`, `status <> deleted` |
| Tickets / open / closed | Credited to the **current** assignee; closed = `solved` or `closed` |
| Bot handoff | Status transition `open → new` (`handed_to_agent_at`). **Not** `OfferedToEvent`. Happens ≤1s after ticket creation — the bot chat has no ticket, so customers "in the bot" cannot be counted |
| First response | Handoff → first **human** agent message (`first_agent_message_at`, from Messaging tag flips; the bot never flips). Credited to `first_response_agent_id` = the assignee at that moment |
| Tiers | < 3 min (green) / ≥ 3 / ≥ 7 / ≥ 10 (nested); unanswered open tickets count live |
| Time to close | Opening → `solved_at` (exact solved transition; `zendesk_updated_at` fallback). Credited to `solved_by_agent_id` |
| Waiting for reply | **Status `open` only.** Customer wrote last: since `customer_waiting_since` (their first message after the agent's last), or since handoff when no agent has written. Covers today **plus** open tickets opened on/after **2026-09-08** (`BACKLOG_FROM_DATE`), the first day with complete tag-flip data |
| Queue | Status `new`, no assignee, by routing group → department (`zendesk_group_departments`). Split into **in hours** / **after hours** by the handoff instant. Wall clock (pickup is wanted now). > 24h counted, not listed |
| Agent picker | Excludes an agent from **every** figure on the screen; per department, localStorage, shared by dashboard and TV (`src/lib/wa-agent-filter.ts`) |
| Availability | Zendesk Agent Availability API every minute: status (incl. custom e.g. "הפסקה"), messaging `work_item_count / max_capacity` (7; can exceed) |

**Business clock** (`src/lib/business-clock.ts`, SQL twin `public.business_seconds`): every WhatsApp duration except the queue counts only inside the department's business hours (`department_business_hours`, currently Sun–Thu 08:00–15:00), never on Fridays/Saturdays, Israeli holidays or their eves (`src/lib/israel-holidays.ts` from the Hebrew calendar via Intl; SQL table `israel_holidays` seeded 2026–2030 — regenerate before 2031). Independent of the after-hours call-routing flag. Chol HaMoed, Purim and Memorial Day eve are working days.

**How Messaging data reaches us** (not obvious): live WhatsApp messages are not ticket comments — the whole chat lands later as one `chat_transcript`. "Who wrote last" comes from a Zendesk Messaging trigger flipping tags `last_whatsapp_reply_agent` / `last_whatsapp_reply_customer`, read from the incremental `ticket_events` export (`added_tags`) by Edge `sync-zendesk-tickets` into `zendesk_whatsapp_messages`, then `recompute_whatsapp_activity` / `recompute_ticket_transitions`. Reliable from 2026-09-08 (partial from 2026-08-25).

**Stored daily record:** `wa_agent_daily` (sums, not averages) rebuilt by pg_cron `wa-agent-daily-rollup` (today + yesterday, every 10 min) and `wa-agent-daily-rollup-nightly` (31 days, 00:30 UTC). Backfilled from 2026-08-01. Read by `/api/wa-history`.

## Key Supabase tables / concepts

- `calls` — live + history; `status`: `in_progress` | `answered` | `missed`
- `agent_live_status` — current presence for wallboard
- `agent_status_history` — duration / status report
- `agents`, `departments`, `department_lines`, `department_groups`
- `call_recordings` — URLs expire (S3); refresh via Aircall API on 403 (`_shared/recordings.ts`)
- `aircall_webhook_events` — idempotent delivery (hash)
- `system_event_logs` — operational errors/warnings
- `agent_day_analyses` — history of daily agent AI analyses
- Feature flags in settings (e.g. `ai_call_analysis`)
- `zendesk_tickets` — synced tickets (+ `handed_to_agent_at`, `first/last_agent_message_at`, `last_customer_message_at`, `customer_waiting_since`, `solved_at`, `first_response_agent_id`, `solved_by_agent_id`)
- `zendesk_whatsapp_messages`, `zendesk_ticket_transitions` — Messaging tag flips / handoffs; status & assignee transitions
- `zendesk_group_departments` — Zendesk routing group → department
- `zendesk_agent_availability` — live agent status + messaging load (one row per Zendesk agent)
- `wa_agent_daily` — stored daily WhatsApp record per agent (see WhatsApp section)
- `israel_holidays`, `department_business_hours` — the business clock's inputs
- `zendesk_sync_state` — export cursors (`last_start_time`, `last_events_start_time`); rewind via SQL to replay

## Edge functions

| Function | JWT | Notes |
| --- | --- | --- |
| `aircall-webhook` | off | Custom webhook key; call + user events |
| `sync-aircall-users` | off | Roster / Away sync; sync secret header |
| `stream-recording` | off | Authenticated stream + URL refresh |
| `analyze-recording` | off | Gemini single-call analysis (Hold/Transfer-aware) |
| `analyze-agent-day` | off | Gemini daily agent analysis; writes `agent_day_analyses` |
| `admin-users` | on | User CRUD via service role; owns its own `ALL_PAGES` list — add every new page there too (v14) |
| `sync-zendesk-tickets` | off | Every minute (pg_cron): incremental tickets + events export, WhatsApp tag flips, transitions, agent availability (v10) |
| `zendesk-probe` | off | Diagnostic only (deployed, no local copy): ticket audits, events since, allow-listed GET; `x-sync-secret` |
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
- Keep `CHANGELOG.md` updated on every meaningful change; keep `PROJECT_CONTEXT.md` updated after product/architecture changes
- **PostgREST embeds:** any new table with FKs to two existing tables (e.g. `wa_agent_daily` → agents + departments) makes PostgREST treat it as a junction and every unhinted embed between those tables answers 300 / `PGRST201` (the app then 500s). Before applying such a migration, hint the FK column in every embed — `agents!agent_id(...)`, `departments!department_id(...)` — in `src/app/api/**` and `supabase/functions/**`; verify with an anon-key curl (300 vs 200) and Supabase `edge_logs`
- New pages go in three places: `src/lib/app-pages.ts`, `src/components/sidebar.tsx`, and `ALL_PAGES` + `pageLabel` in `supabase/functions/admin-users` (redeploy)
- Zendesk: run `gh auth switch --user launchsitex` before pushing if the gh CLI account flipped

## Local commands

```bash
npm install
copy .env.example .env.local
npm run dev
npm run lint && npm run typecheck && npm test && npm run build
```

## Recent production fixes (2026-07)

See `CHANGELOG.md` for the full dated history. Highlights:

- Force `on_call` when open call + live `available` (roster wipe)
- Close stale calls / respect Away presence so Back office is not shown as בשיחה
- Recordings pagination RPC; Aircall recording URL refresh on 403
- Gemini AI analysis (single call + daily agent) behind admin feature flag; Hold/Transfer-aware prompts
