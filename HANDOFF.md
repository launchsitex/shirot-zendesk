# HANDOFF — getting productive on a new machine

Everything an agent (or a person) needs to work on City Live from a fresh computer. Values of secrets are **not** in this file; they are in `HANDOFF_SECRETS.local.md`, which is git-ignored and travels only inside the ZIP/USB copy of the project folder. If that file is missing, every value below says where to get it again.

## 1. What this system is

| Piece | Where | Notes |
| --- | --- | --- |
| Code | GitHub `launchsitex/shirot-zendesk`, branch `main` | Next.js 16 (App Router, Turbopack), React, Tailwind, TypeScript, vitest |
| Production | https://zend-shirot.rc-info.org | Hostinger **Web App** (not a VPS), Node 22, auto-deploys every push to `main` in ~1 min; hPanel is the authority on deploy state |
| Database / auth / edge functions | Supabase project `whshmunahkugkmgxkvvw` (https://whshmunahkugkmgxkvvw.supabase.co) | Postgres + RLS, pg_cron, Vault, Edge Functions (Deno) |
| Calls | Aircall | Webhook → Edge `aircall-webhook`; roster via `sync-aircall-users`; recordings via Aircall API |
| Tickets / WhatsApp | Zendesk (subdomain `rcity`) | Edge `sync-zendesk-tickets` every minute: incremental tickets + events export, Messaging tag flips, agent availability |
| AI analysis | Google Gemini | Edge `analyze-recording`, `analyze-agent-day` |
| Email reports | Resend | Edge `agent-targets-report`, `notify-missed-call` |

Architecture and the pay-critical definitions: `PROJECT_CONTEXT.md`. History: `CHANGELOG.md`.

## 2. Accounts and connections you need

| Connection | Purpose | How it is set up |
| --- | --- | --- |
| **GitHub `launchsitex`** | push = deploy | `gh auth login` as `launchsitex` (the owner's other account `natircity-stack` must **not** be the active one: `gh auth switch --user launchsitex`). Remote: `https://launchsitex@github.com/launchsitex/shirot-zendesk.git` |
| **Supabase MCP** | migrations, edge functions, SQL, logs | Project file `.mcp.json` (in the folder) points Claude Code at `https://mcp.supabase.com/mcp?project_ref=whshmunahkugkmgxkvvw`; it authenticates through the browser with the Supabase account that owns the project (owner's login). In the Claude desktop app the connector is enabled under the project's MCP servers; `.claude/settings.local.json` already allows the Supabase tools |
| **Supabase dashboard** | API keys, edge-function secrets, Vault | https://supabase.com/dashboard/project/whshmunahkugkmgxkvvw — owner's login |
| **Hostinger hPanel** | env vars, redeploy, IP unblock, deploy log | Owner's Hostinger account → Web Apps → the app connected to `shirot-zendesk` |
| **Zendesk admin** | Messaging trigger, agents, custom statuses | `rcity.zendesk.com`, owner's admin user; API token stored as an edge-function secret |
| **Aircall admin** | webhook, API keys | Owner's Aircall admin; keys stored in Supabase Vault |
| **Google AI Studio** / **Resend** | Gemini / email keys | Edge-function secrets |

## 3. Local setup

```bash
npm install
copy .env.example .env.local      # then fill from HANDOFF_SECRETS.local.md
npm run dev                        # http://localhost:3000 (dashboard-dev in .claude/launch.json)
npx tsc --noEmit -p . && npx eslint src && npx vitest run
```

`.env.local` needs only three values (the app has no service-role key anywhere; every privileged write goes through Supabase RLS or an edge function):

```
NEXT_PUBLIC_SUPABASE_URL=https://whshmunahkugkmgxkvvw.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable key — Supabase → Project Settings → API keys>
NEXT_PUBLIC_DEMO_MODE=false
```

Production needs the **same three** in hPanel → Web App → Environment Variables, followed by **Redeploy** (not Restart): `NEXT_PUBLIC_*` is baked in at build time. Missing them = "מצב הדגמה" badge and fake data.

Node 22 locally matches production. `python3` is not installed on the current machine; use `node -e` for scripts.

## 4. Every secret, where it lives, who reads it

| Secret | Lives in | Read by | Get it again from |
| --- | --- | --- | --- |
| Supabase publishable (anon) key | `.env.local`, hPanel env | Next.js (browser + server) | Supabase → Settings → API keys (public by design) |
| Supabase service-role key | Supabase only (edge-function runtime `SUPABASE_SERVICE_ROLE_KEY`) | all edge functions | Supabase → Settings → API keys. Never put it in Next.js |
| `sync_function_secret` | Supabase **Vault** | pg_cron jobs send it as `x-sync-secret`; `sync-zendesk-tickets`, `sync-aircall-users`, `zendesk-probe` check it | `select decrypted_secret from vault.decrypted_secrets where name='sync_function_secret'` |
| `project_url` | Vault | pg_cron jobs build function URLs | same table |
| `aircall-webhook-key` | Vault | `aircall-webhook` (`verify_aircall_webhook_key` RPC); part of the webhook URL configured in Aircall | same table; the URL with the key is shown in Settings → Aircall |
| `aircall-api-id-*` / `aircall-api-token-*` | Vault (one pair per configured integration) | `sync-aircall-users`, recordings refresh | same table; Aircall → Integrations → API keys |
| `API_Zendesk`, `mail_Zendesk`, `ZENDESK_SUBDOMAIN` | Edge-function **secrets** (Supabase → Edge Functions → Secrets) | `sync-zendesk-tickets`, `zendesk-probe` | Zendesk → Admin → Apps and integrations → API (token is shown once; create a new one if lost) |
| `GEMINI_API_KEY` | Edge-function secrets | `analyze-recording`, `analyze-agent-day` | Google AI Studio |
| `RESEND_API_KEY` | Edge-function secrets | `agent-targets-report`, `notify-missed-call` | Resend dashboard |
| `Password_Zendesk` | Edge-function secrets (legacy) | nothing — safe to delete | — |
| App users' passwords | Supabase Auth | — | reset from "ניהול משתמשים" (admin) |

Edge-function secret **values** cannot be read back from Supabase; only names. If a function fails with "not set", re-enter the value there.

## 5. Deploying

- **App:** commit, `gh auth status` (switch to `launchsitex` if needed), `git push origin main`. Hostinger builds (`next build`, type-checked — a TS error fails the build and the previous version stays live) and swaps in ~1 min.
- **Migration:** write `supabase/migrations/<timestamp>_<name>.sql`, apply with MCP `apply_migration` (name = the snake_case part), commit the file. Before any migration that adds a table or FK between existing tables, read `docs/agent-memory/postgrest-embed-ambiguity.md`.
- **Edge function:** edit `supabase/functions/<name>/index.ts`, deploy with MCP `deploy_edge_function` (pass the full file; `verify_jwt` as listed in `PROJECT_CONTEXT.md`), commit. `zendesk-probe` exists only on Supabase (no local copy) — fetch it with `get_edge_function` before touching.
- **Cron:** pg_cron jobs live in migrations (`select cron.schedule(...)`); current list in `PROJECT_CONTEXT.md` / `select jobname, schedule from cron.job`.

## 6. Verifying a deploy without hPanel

- Supabase logs (MCP `query_logs`, source `edge_logs`, user agent `node` = the Next.js server): a request path the new code introduced, or `response.status_code` — 300 on `/rest/v1/*` means a PostgREST embed ambiguity, 200 means the new build is live.
- Anon-key check of any embed: `curl "$URL/rest/v1/<table>?select=<embed>&limit=1" -H "apikey: $KEY" -H "Authorization: Bearer $KEY"` → 200 vs 300 (RLS may return no rows, the status is still meaningful).
- `curl https://zend-shirot.rc-info.org/login` → 200; a `403 Forbidden` page from LiteSpeed is the per-IP flood limiter, not the app.

## 7. Files that only exist locally (copy them with the ZIP)

| File | Why |
| --- | --- |
| `.env.local` | the three public env values |
| `.mcp.json` | Supabase MCP connection for Claude Code |
| `.claude/settings.local.json`, `.claude/launch.json` | tool permissions Claude already has; dev-server launch config |
| `HANDOFF_SECRETS.local.md` | the secret values gathered on 2026-09-10 |
| `docs/agent-memory/` | **is** committed — Claude Code's per-machine memory notes, copied into the repo |

Claude Code's own memory directory (`%USERPROFILE%\.claude\projects\<project-path>\memory\`) does not travel; the notes in `docs/agent-memory/` replace it. On the new machine, tell Claude to read `CLAUDE.md` first (it is loaded automatically when the project folder is opened).

## 8. Open items as of 2026-09-10

- Supabase CPU load: `sync-aircall-users` every minute and Realtime on `aircall_webhook_events` were flagged earlier; not yet addressed.
- Two old Aircall numbers still mapped; clean up in Settings → Aircall.
- `Password_Zendesk` edge secret is unused — delete. `zendesk-probe` is still useful as a diagnostic; keep.
- RLS still open on `queue_snapshots`, `zendesk_customers` (hold caller numbers).
- WhatsApp: customers still inside the bot flow cannot be counted (no ticket exists yet); only via Sunshine Conversations API with a separate key.
- Erev Shvi'i shel Pesach is treated as a closed day; owner to confirm.
