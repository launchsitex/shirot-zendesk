# CLAUDE.md — read this first on any machine

This repo is the **City Live** call-center dashboard for רהיטי הסיטי (Hebrew, RTL): Aircall calls + Zendesk/WhatsApp tickets, Next.js 16 on Hostinger, Supabase behind it. The owner (admin) works with Claude Code from more than one computer, so everything an agent needs is in the repo:

1. **`HANDOFF.md`** — how to get productive on a fresh machine: accounts, connections, secrets (where they live), deploy flow, verification tricks. Start there.
2. **`PROJECT_CONTEXT.md`** — architecture, routes, tables, edge functions, and the **definitions that agent pay depends on** (WhatsApp dashboards section). Do not let those drift.
3. **`CHANGELOG.md`** — dated history. **Update it on every meaningful change** (product, migration, edge function, behavior). Newest first, Hebrew, `[YYYY-MM-DD]` → title → what / why / files.
4. **`docs/agent-memory/`** — the notes Claude Code kept in its per-machine memory, copied into the repo so a new machine has them. Read `docs/agent-memory/README.md`; each note says why it exists and how to apply it.

## Rules that have bitten us (short version — details in the files above)

- **Push to `main` = production deploy** (Hostinger Web App, ~1 min). Commit/push only when the owner asks ("כן תפרסם"). Before pushing run `gh auth status`; if the active account is not `launchsitex`, `gh auth switch --user launchsitex`.
- **Supabase migrations and edge functions do not deploy with git.** Apply them with the Supabase MCP (`apply_migration`, `deploy_edge_function`) *and* keep the file in `supabase/migrations` / `supabase/functions` in the same commit.
- **PostgREST embed ambiguity:** any new table/FK that links two existing tables makes every unhinted embed between them answer 300 (`PGRST201`) and the app 500s. Hint FK columns (`agents!agent_id(...)`, `departments!department_id(...)`) before applying; verify with an anon-key curl (see HANDOFF.md).
- **New page = three places:** `src/lib/app-pages.ts`, `src/components/sidebar.tsx`, and `ALL_PAGES` + `pageLabel` in `supabase/functions/admin-users` (then redeploy that function). New pages are admin-only until granted in "ניהול משתמשים".
- **Demo mode badge ("מצב הדגמה") is a build-env problem, not data loss** — `NEXT_PUBLIC_SUPABASE_*` missing at build time on Hostinger. Verify the data in Supabase before believing "the data is gone".
- **Numbers on the WhatsApp screens are used for pay and bonuses.** Any change to a definition must be explained to the owner in plain Hebrew first, then documented.
- Hebrew UI copy, RTL-aware layout, prefer existing patterns. Run `npx tsc --noEmit -p . && npx eslint <files> && npx vitest run` before every push.

## Working style the owner expects

- Answer in Hebrew, short, concrete. Explain what a change means for the figures before doing it when it touches definitions; otherwise just do it and report.
- Verify against the live database (Supabase MCP `execute_sql`) rather than guessing; quote the actual numbers.
- After a deploy, confirm from Supabase `edge_logs` that the app's requests return 200 (see HANDOFF.md → "Verifying a deploy").
