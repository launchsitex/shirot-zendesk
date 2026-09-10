---
name: github-auth-account-flip
description: "gh CLI's active GitHub account keeps flipping to natircity-stack; switch to launchsitex before every push"
metadata: 
  node_type: memory
  type: project
  originSessionId: 0c026c3e-a01c-4010-814d-179343d3079d
  modified: 2026-09-06T10:44:02.989Z
---

The machine's `gh` CLI has two logged-in GitHub accounts (`launchsitex` and
`natircity-stack`), and the active one keeps reverting to `natircity-stack`
between sessions even though the repo push needs `launchsitex`. This has now
recurred at least twice (once documented as "git push failed three times" in
session context, once again on 2026-09-06) despite `origin` already being
pinned to `https://launchsitex@github.com/...` — the remote URL alone does
not fix it, because `gh`'s credential helper uses whichever account is
currently active regardless of the URL's embedded username.

**Why this matters:** [[hosting-deploy-reality]] — pushing to `main` triggers
Hostinger's auto-deploy, so a failed push silently blocks a deploy the user is
expecting.

**How to apply:** before pushing to `origin` in this repo, run
`gh auth status` — if the active account shown is not `launchsitex`, run
`gh auth switch --user launchsitex` first. Cheap to check every time; do not
assume the previous session's switch persisted.
