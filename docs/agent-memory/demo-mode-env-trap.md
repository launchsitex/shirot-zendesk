---
name: demo-mode-env-trap
description: "Dashboard silently serves fake data when NEXT_PUBLIC_SUPABASE_* are missing at build time — looks like data loss, isn't"
metadata: 
  node_type: memory
  type: project
  originSessionId: c2accc37-8516-4224-a1df-3c9b2849ea79
  modified: 2026-08-10T11:49:47.846Z
---

If the dashboard suddenly shows tiny call counts and an orange **"מצב הדגמה"** badge, no data has been lost. `/api/dashboard` falls back to `getMockDashboardData()` whenever `isSupabaseConfigured()` is false or `NEXT_PUBLIC_DEMO_MODE === "true"`, and `isSupabaseConfigured()` only checks that `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are set.

**Why it bites:** `NEXT_PUBLIC_*` variables are inlined by Next.js **at build time**. Hostinger rebuilds on every push to `main`, so a build that runs without those variables produces a bundle permanently stuck in demo mode — restarting does nothing, only a rebuild with the variables present fixes it. Happened 2026-08-10 after a routine deploy; the user reported it as "you destroyed the data".

**How to tell the two causes apart without hPanel** (one request, mind the flood limiter): `curl -s https://zend-shirot.rc-info.org/login | grep -o "כניסה למצב הדגמה\|כניסה למערכת"`. "כניסה למצב הדגמה" means the Supabase vars are missing from the build; "כניסה למערכת" means they are present and `NEXT_PUBLIC_DEMO_MODE=true` is the culprit instead. A second tell on the dashboard: the short-no-answer threshold renders as 0 instead of the configured 10, because that hook cannot reach the DB either.

**Fix:** set the two variables in hPanel → Web App → Environment Variables, ensure `NEXT_PUBLIC_DEMO_MODE` is `false` or absent, then **Redeploy** (not restart). Values live in the project's local `.env.local` and in Supabase → Project Settings → API.

**Always verify the data first** before accepting a "data is gone" report — query Supabase directly. See [[hosting-deploy-reality]].
