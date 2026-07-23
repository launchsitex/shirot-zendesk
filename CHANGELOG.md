# CHANGELOG — City Live / רהיטי הסיטי

יומן שינויים של הפרויקט. **חובה לעדכן בכל שינוי בקוד, מיגרציה, Edge Function, או התנהגות מוצר.**

פורמט: `[YYYY-MM-DD]` → כותרת קצרה → bullets (מה / למה / קבצים עיקריים).
הערכים החדשים ביותר בראש הקובץ.

ראה גם: `PROJECT_CONTEXT.md` (ארכיטקטורה וכללים קבועים) — כאן רק **מה השתנה**.

---

## [2026-07-23] — פיצול דף Settings לטאבים לפי קטגוריה

### UI
- במקום חמישה כרטיסים מוערמים — ארבעה טאבים (שיחות שלא נענו, שעות
  פעילות, AI, Aircall) דרך `SettingsTabs` בצד הלקוח.
- קבצים: `src/app/settings/page.tsx`, `src/components/settings-tabs.tsx`.

---

## [2026-07-23] — ניקוי כתובת שולח מה-seed של התראות missed-call

### הגדרות
- שורת ה-bootstrap seed נוקתה מכתובת שולח של לקוח ספציפי (`null`) —
  התקנה חדשה (כולל replay מלא של מיגרציות) מתחילה לא-מוגדרת ודורשת
  הזנה ושמירה ב-Settings.
- קבצים: `supabase/migrations/20260723074747_clear_missed_call_notification_from_email_seed.sql`.

---

## [2026-07-23] — בלי כתובת שולח קשיחה ב-notify-missed-call

### אבטחה / הגדרות
- הוסר fallback לכתובת שולח hardcoded ב-Edge Function; גם ברירת המחדל
  בעמודת DB הוסרה. בלי שולח מוגדר בהגדרות — לא נשלח מייל.
- קבצים: `supabase/functions/notify-missed-call/index.ts`,
  `supabase/migrations/20260723073859_missed_call_notification_from_email_no_default.sql`.

---

## [2026-07-23] — התראות מייל על שיחות שלא נענו (Resend)

### תשתית התראות
- אדמין מגדיר ב-Settings כתובת שולח ורשימת נמענים להתראות על שיחות
  `missed`.
- טריגר על `public.calls` שולח פעם אחת כששיחה הופכת ל-`missed` ל-Edge
  Function חדשה `notify-missed-call`, שמיישמת את אותו סף "מענה קצר /
  לא-נענה" כמו בשאר האפליקציה, ואז שולחת מייל HTML בעברית RTL דרך Resend.
- קבצים: `src/app/settings/page.tsx`,
  `src/app/api/settings/missed-call-notifications/`,
  `src/components/missed-call-notification-settings.tsx`,
  `supabase/functions/notify-missed-call/`,
  `supabase/migrations/20260723073102_missed_call_email_notifications.sql`.

---

## [2026-07-23] — התעלמות מקבצי IDE מקומיים ב-git

### Repo hygiene
- `.claude/` ו-`.mcp.json` נוספו ל-`.gitignore` כדי ש-`git status` יישאר נקי
  ולא ידחוף קונפיג מקומי של Cursor/Claude.
- קבצים: `.gitignore`.

---

## [2026-07-23] — שיחות שלא נענו: הצגת זמן המתנה במקום Talk Time

### UI — היסטוריית שיחות
- בשיחה `missed` עמודת משך מציגה כעת **המתנה** (`waitTimeSeconds`) במקום
  משך דיבור (שאינו רלוונטי כשלא הייתה מענה).
- קבצים: `src/components/section-pages.tsx`.

---

## [2026-07-22] — לוג מלא לכל webhook נכנס ב-aircall-webhook

### Observability
- בכל קבלת POST ל-`aircall-webhook` נכתב כעת לוג Edge עם סוג האירוע
  וה-payload המלא (השדה `token` מוסתר). גם גוף JSON לא-תקין נרשם.
- קבצים: `supabase/functions/aircall-webhook/index.ts`.

---

## [2026-07-22] — תיקון סטטוס נציג תקוע/שגוי במסך מוקד (TV)

### באג — ארכיטקטורה של כתיבות כפולות/מתפצלות לסטטוס נציג
- מנהלים דיווחו שסטטוס נציג במסך המוקד (TV) לא מתעדכן כשהוא משתנה
  בפועל ב-Aircall (למשל נכנס לשיחה, משנה נוכחות).
- הסיבה: היו **6 כותבים עצמאיים** לעמודת `agent_live_status.state`, עם
  **3 עותקים נפרדים ומתפצלים** של לוגיקת "תרגום סטטוס Aircall לסטטוס
  פנימי" — `mapAvailability` ב-webhook, `mapState` ב-cron
  `sync-aircall-users` (רץ כל דקה ללא תלות באירועים), ו-
  `private.aircall_state_from_user()` ב-SQL (נקרא משני triggers).
  אומתו אי-התאמות בפועל: `"custom"` ממופה ל-`available` בעותק אחד
  ול-`scheduled` בשניים אחרים; ל-`mapState` חסרים מפתחות נרדפים
  שקיימים בעותקים האחרים — ומכיוון שהוא רץ כל 60 שניות ללא קשר
  לאירועים, ערך לא-מזוהה שם גורם לסטטוס שגוי שנכפה מחדש כל דקה. טריגר
  SQL נוסף (`apply_aircall_user_status`) התברר ככפילות מוחלטת של מה
  שהוובהוק כבר כתב רגע קודם באותה בקשה.
- תוקן ע"י איחוד הלוגיקה למקור אמת יחיד: `mapAvailability()` חדש ב-
  `supabase/functions/_shared/aircall-status.ts`, בשימוש הן ע"י
  ה-webhook והן ע"י ה-cron. שני ה-triggers המיותרים ב-SQL
  (`apply_aircall_user_status`, `guard_aircall_agent_status_order`)
  הוסרו במיגרציה חדשה. **החלטת מוצר:** סטטוס "Custom"/לא-מזוהה מוצג
  כעת כ-`other` ("אחר") במקום נדחס בטעות ל"זמין" או "לפי לוח".
- קבצים: `supabase/functions/_shared/aircall-status.ts` (חדש),
  `supabase/functions/aircall-webhook/index.ts`,
  `supabase/functions/sync-aircall-users/index.ts`,
  `supabase/migrations/20260722140000_retire_duplicate_agent_status_triggers.sql`.

---

## [2026-07-22] — תיקון "gemini_empty_response" בניתוח AI לנציג

### באג — ניתוח יום נציג נעצר ב-~80% עם שגיאת gemini_empty_response
- מנהלים דיווחו שניתוח AI ליום עבודה של נציג (`/agent-ai-analysis`) מתקדם עד כ-80% ואז נכשל עם השגיאה `gemini_empty_response` (HTTP 500 מ-`analyze-agent-day`).
- הסיבה: הקריאה ל-`gemini-2.5-pro` לא הגבילה `maxOutputTokens`/`thinkingConfig.thinkingBudget`. ה"חשיבה" הפנימית של המודל נספרת מתוך תקציב הפלט — באצווה עם שיחות ארוכות/Transfer/Hold המודל יכול "לגמור" את כל התקציב על חשיבה ולהחזיר תשובה ריקה (`finishReason: MAX_TOKENS`), בדיוק ליד סוף רשימת האצוות (סביב 80%-90% התקדמות).
- תוקן ע"י: הגבלת `thinkingConfig.thinkingBudget` לערך נמוך וקבוע (1024) והגדרת `maxOutputTokens` נדיב (16384) כדי שתמיד יישאר מקום לתשובת ה-JSON בפועל; נוסף retry עם backoff (עד 2 ניסיונות חוזרים) על `gemini_empty_response` ועל שגיאות 429/5xx חולפות — אותו דפוס retry שכבר קיים ב-`_shared/zendesk.ts`.
- קבצים: `supabase/functions/analyze-agent-day/index.ts`.

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
