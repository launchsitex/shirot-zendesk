---
name: hosting-deploy-reality
description: "Production is a Hostinger Web App with GitHub auto-deployment — pushing to main DOES deploy, in about a minute"
metadata:
  node_type: memory
  type: project
  originSessionId: 129a8761-8a7c-46b4-b284-caefc0d8abb1
  modified: 2026-08-02T08:28:41.166Z
---

The City Live dashboard production is a **Hostinger "Web Apps" deployment** serving **https://zend-shirot.rc-info.org** (browser → Hostinger CDN `Server: hcdn` on 92.113.x → origin LiteSpeed at 31.97.121.216 → Next.js on :3000). See [[customer-domains]].

**Pushing to `main` DOES deploy.** Corrected 2026-08-02 from the hPanel dashboard: the app shows *Connected with GitHub* and *Auto-deployment* enabled, repository `shirot-zendesk`, branch `main`, root `./`, framework Next.js, Node 22.x. Commit `e39876dd` pushed at ~11:12 deployed by itself at **11:13, taking 1m 0s**, state Completed. There is no manual step and no SSH/pm2 — it is not a VPS.

**Why the earlier note said the opposite (do not repeat this mistake):** on 2026-07-30 this was recorded as "push ≠ deploy, manual hPanel only" because the *GitHub repo* had no Vercel integration, no webhooks, no deploy keys and no commit statuses. Hostinger's Web Apps integration does not surface as any of those on the repo side, so that check proved nothing. **Never infer the deploy mechanism from the GitHub repo alone** — the authority is the hPanel dashboard (`Last deployment` card: state, commit SHA, timestamp, duration), and the user can screenshot it in seconds.

**How to verify a deploy landed**, without hPanel access: compare production behavior against HEAD using `pg_stat_statements` — query shape (a clause a known commit introduced, plus its `stats_since`) dates the running build, and a rate delta (sum a query family's `calls`, wait 30-60s, divide by the `now()` gap) shows which client polling code is live. This is how the pre-deploy build was dated; see [[rls-department-hardening]] for the same DB-as-oracle trick.

**The 403 is unrelated to deploys** and that part still holds: LiteSpeed's per-IP anti-flood serves `403 Forbidden — "Access to this resource on the server is denied!"` *before* the app. When users report it the site is fine for everyone else — check with `curl https://zend-shirot.rc-info.org/login` (expect 200) and treat it as an IP block plus a request-volume problem, never an app outage. Unblock the IP in hPanel; the durable fix is keeping per-IP request volume low (the polling rules in `section-pages.tsx` / `dashboard-client.tsx`).

**Still true:** Supabase Edge Functions and migrations deploy separately (MCP `deploy_edge_function` / `apply_migration`), not via the GitHub push.
