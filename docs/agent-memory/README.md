# Agent memory notes (copied from Claude Code's per-machine memory, 2026-09-10)

These are the notes Claude Code kept about this project on the owner's first machine. They do not travel with the repo on their own, so they live here. Each note has a *Why* and a *How to apply*. On a new machine, read them once; when one turns out to be wrong, fix it here and in the machine memory both.

## Index

- [Demo-mode env trap](demo-mode-env-trap.md) — "מצב הדגמה" + tiny numbers = NEXT_PUBLIC_SUPABASE_* missing at build time, not data loss
- [Hosting & deploy reality](hosting-deploy-reality.md) — Hostinger Web App w/ GitHub auto-deploy: push to main DOES deploy (~1 min); LiteSpeed serves the 403 page
- [Customer domains](customer-domains.md) — rcity.co.il on Cloudflare; dashboard prod domain unknown; agency nf-digital.net
- [Gemini PROHIBITED_CONTENT skip](gemini-prohibited-content-skip.md) — one blocked call audio ≠ failed report; check system_event_logs + skipped_recordings first
- [RLS department hardening](rls-department-hardening.md) — applied+verified 2026-07-30; queue_snapshots/zendesk_customers still open
- [GitHub auth account flip](github-auth-account-flip.md) — gh CLI reverts to natircity-stack; run `gh auth switch --user launchsitex` before every push
- [PostgREST embed ambiguity](postgrest-embed-ambiguity.md) — a new table with FKs to agents+departments turns every unhinted embed into 300/PGRST201; hint FK columns before applying migrations
