---
name: gemini-prohibited-content-skip
description: "Gemini can hard-block a single call's audio (PROHIBITED_CONTENT) — analyze-agent-day v15 retries twice, skips it, report completes"
metadata: 
  node_type: memory
  type: project
  originSessionId: 129a8761-8a7c-46b4-b284-caefc0d8abb1
  modified: 2026-07-30T13:42:02.645Z
---

`gemini_empty_response` in `analyze-agent-day` is not always a code bug: Gemini's safety filter can block a specific call's **audio** at prompt level — `promptFeedback.blockReason: "PROHIBITED_CONTENT"`, `candidateCount: 0`, finishReason null. Retries cannot fix a prompt-level block.

**Why:** On 2026-07-29 the daily report for agent מור אלקיים (2003831) hit this on call `3999276611` (outbound, ~10 min, 2.3MB mp3, callIndex 33). v15 logged it to `system_event_logs` (category `ai-agent-day`, stages `gemini-call` → `batch-single-call`), skipped the call, and the report for 2026-07-28 completed (46 calls, score 7, skipped_recordings=1).

**How to apply:** When a daily analysis "fails silently", first check `system_event_logs` category `ai-agent-day` and `agent_day_analyses.skipped_recordings` before touching code. Invoking the function manually requires an admin **user** JWT (it checks `profiles.role='admin'` against the bearer token), so it can't be triggered from MCP/service tooling alone.
