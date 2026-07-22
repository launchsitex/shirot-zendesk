# CHANGELOG — City Live / רהיטי הסיטי

יומן שינויים של הפרויקט. **חובה לעדכן בכל שינוי בקוד, מיגרציה, Edge Function, או התנהגות מוצר.**

פורמט: `[YYYY-MM-DD]` → כותרת קצרה → bullets (מה / למה / קבצים עיקריים).
הערכים החדשים ביותר בראש הקובץ.

ראה גם: `PROJECT_CONTEXT.md` (ארכיטקטורה וכללים קבועים) — כאן רק **מה השתנה**.

---

## [2026-07-22] — פיצ'ר: סף "לא נענה פחות זמן" (ניתן להגדרה)

### פיצ'ר חדש
- מנהל יכול להגדיר בעמוד ההגדרות סף המתנה בשניות (גלובלי, ברירת מחדל 60). שיחות נכנסות שלא נענו וזמן ההמתנה של הלקוח בהן היה מתחת לסף מסווגות לתצוגה כ"לא נענה פחות זמן" — לא נספרות כ"לא נענו" ולא משפיעות על אחוז המענה (כללי או פר-מחלקה/נציג), אך ממשיכות להופיע בכל מקום במערכת. `calls.status` ב-DB לא משתנה — סיווג נגזר/display-only בלבד (`isShortNoAnswer()` ב-`metrics.ts`), כך שנתוני עבר לא נמחקים ולא משתנים.
- **חריג מכוון:** מסך מוקד (TV) (`/wallboard`) ממשיך להציג את מונה "לא נענו" המקורי (כולל שיחות קצרות) — לא עבר את הסינון החדש, לפי בקשה מפורשת (הכי חשוב שם יציבות/פשטות, לא הפילוח).
- טבלה חדשה `missed_call_settings` (singleton row, RLS admin-write) — קובץ migration בלבד, טרם הורץ מול Supabase החי.
- מחוץ להיקף: ה-Edge Function `analyze-agent-day` (עמוד "ניתוח AI לנציגים") לא עודכן — runtime נפרד, ידרוש שינוי נפרד בהמשך אם יידרש.
- קבצים עיקריים: `supabase/migrations/20260722120000_missed_call_threshold.sql`, `src/app/api/settings/missed-call-threshold/route.ts`, `src/hooks/use-missed-call-threshold.ts`, `src/components/missed-call-threshold-settings.tsx`, `src/lib/metrics.ts`, `src/lib/types.ts`, `src/lib/excel-export.ts`, `src/components/section-pages.tsx`, `src/components/dashboard-client.tsx`, `src/app/after-hours/after-hours-client.tsx`.

---

## [2026-07-22] — תיקון תנודתיות במונה "לא נענו" במסך מוקד (TV)

### באג — Race condition בטעינת נתונים
- מנהלות דיווחו שהתא "לא נענו" במסך המוקד (`/wallboard`) מציג לפעמים ערך שונה בין רענון לרענון (למשל 17 ואז 16) בלי שהנתונים באמת השתנו.
- הסיבה: `loadData()` נקרא בו-זמנית ממספר מקורות (פולינג כל 10 שניות + מנוי Realtime של Supabase על `calls`/`agent_live_status`/`agents`), בלי הגנה על סדר התגובות. תגובת fetch "ישנה" שחוזרת מהרשת אחרי תגובה "חדשה" הייתה דורסת אותה ב-`setData`.
- תוקן ע"י הוספת `latestRequest` ref שמסמן מספר סידורי לכל בקשה ומוודא שרק תגובת ה-fetch העדכנית ביותר מעדכנת את ה-state — אותו דפוס שכבר קיים ועובד ב-`dashboard-client.tsx`.
- קבצים: `src/components/wallboard-client.tsx`.

---

## [2026-07-21] — CHANGELOG חובה + כלל Cursor

- נוצר `CHANGELOG.md` כיומן שינויים מרכזי (מהיום והלאה + סיכום יולי 2026).
- נוסף כלל תמיד-פעיל: `.cursor/rules/update-changelog.mdc` — חובה לעדכן את ה-CHANGELOG בכל שינוי משמעותי.
- `PROJECT_CONTEXT.md` עודכן (קישור ל-CHANGELOG, route `/agent-ai-analysis`, `analyze-agent-day`, טבלת `agent_day_analyses`).

---

## [2026-07-21] — ניתוח AI לשיחות/נציגים, Hold/Transfer, סטטוס לייב

### AI — Hold + Transfer בהקלטות
- ניתוח Gemini מודע ל-Hold ול-Transfer: לא לשפוט רעשי מוקד בזמן Hold; בשיחות שהועברו — לנתח רק את הנציג המנותח.
- חילוץ חלונות Hold ואירועי Transfer מ-`call_raw` / webhook.
- קבצים: `supabase/functions/_shared/recordings.ts`, `analyze-recording`, `analyze-agent-day`, `aircall-webhook`.

### AI — ניתוח יומי לנציג + היסטוריה
- דף חדש `/agent-ai-analysis` (אדמין + דגל `ai_call_analysis`).
- Edge `analyze-agent-day` + טבלה `agent_day_analyses` (היסטוריית ניתוחים).
- הרשאות סיידבר / `app-pages` / ניהול משתמשים.
- קבצים: `src/app/agent-ai-analysis/*`, `src/app/api/agent-ai-analysis/route.ts`, מיגרציה `20260721160000_agent_day_analyses_history.sql`.

### חיפוש טלפון
- נרמול מקומי/בינלאומי בחיפוש מספרים.
- מיגרציה: `20260721150000_phone_search_local_intl_normalization.sql`.

### סטטוס Aircall / Wallboard (תיקוני ייצור)
- סגירת שיחות `in_progress` תקועות תוך כיבוד Away (Back office וכו').
- Reconciliation ל-`on_call` משיחות פעילות; תזמון reconciliation; חיזוק טריגר סטטוס.
- מיגרציות: `20260721103000_*`, `20260721120000_*`, `20260721130000_*`, `20260721140000_*`.
- קבצים: `aircall-webhook`, `sync-aircall-users`, `src/app/api/dashboard/route.ts`, `wallboard-client.tsx`.

### שעות פעילות / After-hours / ייצוא
- עדכוני business hours, דף after-hours, הקלטות, excel export, הגדרות AI/business-hours API.

---

## [2026-07-20] — הקלטות, AI בסיסי, העברות, שעות מחלקה

- Pagination RPC להקלטות (`list_call_recordings_page`); רענון URL מ-Aircall ב-403.
- Feature flag `ai_call_analysis` + דף `/ai-analysis` + Edge `analyze-recording`.
- מעקב העברות שיחה (`call_transfer_tracking`).
- שעות פעילות למחלקה (`department_business_hours`).
- היסטוריית סטטוס נציגים + לוג מערכת.
- ניהול משתמשים / פרופילים.

---

## [2026-07-19] — מעבר ל-Aircall + בסיס הדשבורד

- Bootstrap ראשוני (Zendesk-era) ואז מעבר ל-Aircall כמקור לייב.
- Webhook Aircall, מחלקות/קווים/צוותים, סאב-סטטוסים רשמיים, roster sync.
- הקלטות, Realtime agents, אבטחה ו-RLS, מניעת overwrite של סטטוס שיחה ישן.
- כיבוי jobs של Zendesk כשהמקור העיקרי הוא Aircall.

---

## תבנית לכניסה חדשה

```markdown
## [YYYY-MM-DD] — כותרת קצרה

### נושא
- מה השתנה ולמה.
- קבצים / מיגרציות / Edge Functions רלוונטיים.
```
