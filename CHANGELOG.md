# CHANGELOG — City Live / רהיטי הסיטי

יומן שינויים של הפרויקט. **חובה לעדכן בכל שינוי בקוד, מיגרציה, Edge Function, או התנהגות מוצר.**

פורמט: `[YYYY-MM-DD]` → כותרת קצרה → bullets (מה / למה / קבצים עיקריים).
הערכים החדשים ביותר בראש הקובץ.

ראה גם: `PROJECT_CONTEXT.md` (ארכיטקטורה וכללים קבועים) — כאן רק **מה השתנה**.

---

## [2026-08-06] — זמני שיחות בעמוד "יעדים לנציגים"

### מוצר
- נוספו שתי עמודות: **"זמן שיחות נכנסות"** ו-**"זמן שיחות יוצאות"**, לכל
  נציג פר מחלקה, בפורמט שעות:דקות, לאותה תקופה שנבחרה בסינון התאריך.
  הסכומים מופיעים גם בכותרת של כל מחלקה.

### הגדרה
- הזמן הוא `talk_time_seconds` ולא `duration_seconds`: ביוצאות ה-duration
  כולל גם חיוג וצלצול, כך שנציג שמחייג ל-30 מספרים שאיש לא עונה בהם היה
  מוצג עם שעות של "זמן שיחות" בלי שדיבר עם אף אחד.
- בשונה מעמודת "בפועל", עמודות הזמן **כן** כוללות שיחות שהנציג העביר
  הלאה — היעד מודד זכאות לטיפול, הזמן מודד כמה זמן הנציג באמת היה על הקו.

### תשתית
- `public.agent_target_report` מחזירה שתי עמודות נוספות. בוצע DROP+CREATE
  ולא `CREATE OR REPLACE` כי Postgres לא מאפשר לשנות טיפוס החזרה במקום;
  רשימת הפרמטרים לא השתנתה, ולכן ה-Edge Function של המייל היומי והעמוד
  ממשיכים לקרוא לה בדיוק כמו קודם.
- אומת מול נתוני אמת שההתנהגות הקיימת לא נדרסה: `inbound_answered`
  זהה לספירה ישירה (79=79), וזמני הנכנסות והיוצאות תואמים סכום ישיר
  (25,295 ו-5,207 שניות).
- נוסף `formatHoursMinutes` ב-`agent-targets.ts` — `formatDuration` הקיים
  מחזיר mm:ss שמתאים לשיחה בודדת, לא לסך יומי.
- קבצים: `supabase/migrations/20260806090000_agent_target_report_talk_time.sql`,
  `src/lib/agent-targets.ts`, `src/app/api/agent-targets/route.ts`,
  `src/components/agent-targets-page.tsx`, `src/lib/agent-targets.test.ts`.

---

## [2026-08-03] — קווים שהוצאו משימוש מפסיקים להיספר

### אבחון — "שיחות ממתינות שלא מצלצלות אצל אף נציג"
- דווח: 3 שיחות ממתינות ~25 דקות בזמן שיש נציגים זמינים באספקות.
- **לא תקלת webhook ולא באג בדשבורד.** ה-webhook חי (114 כתיבות ב-30
  דקות, שיחות אחרות עוברות מחזור מלא), והדשבורד הציג נכון מצב אמיתי.
- הסיבה: השיחות נכנסו לקו Aircall `"אספקות - ישן"`
  (`+972 55-339-0267`, line 1325898). ב-payload: `"teams": []` אבל
  `"availability_status": "open"` — המספר פתוח ומקבל שיחות, אין אליו צוות,
  ולכן Aircall עונה, מנגן מוזיקת המתנה ולא מצלצל אצל איש. האירוע היחיד
  שנרשם הוא `call.created`.
- ראיה משלימה מאותו יום: בקו הישן 3 שיחות / 0 נענו / 3 תקועות; בקו החי
  `אספקות` (`+972 55-338-6237`) 302 שיחות / 204 נענו / 0 תקועות.
- רקע: אותו line_id היה הקו הפעיל עד 26/07 (1,843 נכנסות, 1,391 נענו).
  במעבר למספרים החדשים הקווים שונו ל"- ישן" והצוותים הוסרו, אבל הם
  נשארו פתוחים. אותו סיפור ב-`"שירות - ישן"` (`+972 55-330-1759`).
- שני מסלולים מגיעים לשם: לקוחות עם המספר הישן שמור, **וגם העברות של
  נציגים** — ב-09:09:17 בוצעה העברה חיצונית, ושנייה קודם אותו לקוח הופיע
  כשיחה תקועה חדשה על הקו הישן.
- השורות התקועות נסגרות מעצמן אחרי 30 דקות ע"י
  `private.sweep_stale_open_calls` ומסומנות `missed`.
- **התיקון האמיתי הוא ב-Aircall** — לסגור/לנתב את שני המספרים הישנים
  ולתקן את יעד ההעברה של הנציגים. הסינון למטה מסתיר, לא פותר.

### תשתית — `talk_lines.excluded_from`
- נוספה עמודה `excluded_from timestamptz` ל-`talk_lines`: כשהיא מוגדרת,
  שיחות על הקו שהתחילו ממנה והלאה לא נספרות ולא מוצגות. הוגדרה
  `2026-07-26 15:00:00+00` לשני הקווים הישנים.
- הגבול הוא מועד המעבר ולא "עכשיו", כדי שכל התעבורה מהתקופה שבה אלה היו
  הקווים החיים תישאר. בפועל: **74 שיחות הוסתרו, 6,576 נשמרו.**
- `department_lines` לא שונה בכוונה — המיפוי הוא מה שהטביע `department_id`
  על השורות ההיסטוריות, וסנכרון חוזר חייב לפתור אותו זהה.
- הסינון הוחל ב-`/api/dashboard` (מזין את כל המסכים) וב-
  `public.agent_target_report` (העמוד והמייל היומי), כתנאי אחד לכל קו:
  לשמור שורה אלא אם היא על אותו קו **וגם** התחילה אחרי ה-cutoff שלו.
- קבצים: `supabase/migrations/20260803120000_exclude_retired_lines.sql`,
  `src/app/api/dashboard/route.ts`.

---

## [2026-08-02] — יעדים לנציגים: הגדרה, עמוד מעקב ודוח יומי במייל

### מוצר — פיצ'ר חדש
- טאב חדש בהגדרות, **"יעדים לנציגים"**: מטריצה של נציגים פעילים מול
  מחלקות, יעד שיחות נכנסות יומי לכל תא, כולל רשימת תפוצה למייל ומתג
  הפעלה/כיבוי לדוח. נשמרים רק תאים שהשתנו.
- עמוד חדש **"יעדים לנציגים"** (`/agent-targets`): בחירת תאריך, פירוט פר
  מחלקה ופר נציג — יעד, בפועל, פער ואחוז עמידה. ברירת המחדל היא החתך
  שנשלח במייל (00:00–15:30), עם אפשרות "יום מלא".
- דוח יומי במייל ב-15:30 שעון ירושלים, עברית מלאה RTL, מקובץ לפי מחלקה
  עם שורת סה״כ לכל מחלקה.

### הגדרת המדד (סוכם מול הלקוח)
- נספרות שיחות `direction='inbound'` + `status='answered'` המשויכות
  לנציג, **בניכוי** שורות שבהן `transferred_by_agent_id = agent_id`.
- הרקע: Aircall מתעד שני סוגי העברה אחרת לגמרי. בהעברה **פנימית**
  הבעלות עוברת ו-`agent_id` נעשה נציג היעד — הנציג המעביר יוצא מהספירה
  מעצמו (17 שורות בנתונים). בהעברה **חיצונית** הנציג נשאר `agent_id`
  ומסומן גם כמעביר — 503 שורות, ~11% מהנכנסות שנענו; אלו השורות
  שהסינון מנכה. שיחה שהועברה **אל** הנציג כן נספרת לו.
- שיוך לפי `department_id` של **השיחה**, לא של הנציג: 8 נציגים עונים
  לשתי המחלקות ולכל אחת מהן יעד נפרד.
- אימות מול נתוני אמת (02/08): 256 נכנסות שנענו − 35 העברות עצמיות = 221,
  זהה לסכום שמחזירה הפונקציה.

### תשתית
- מיגרציה `20260802100000_agent_call_targets.sql`: טבלאות
  `agent_call_targets` / `agent_target_report_settings` /
  `agent_target_report_recipients` + RLS (קריאה לפי מחלקה כמו
  `20260730200000`, כתיבה לאדמין בלבד), ופונקציה
  `public.agent_target_report(from, to)` — מקור אמת יחיד למדד, כך
  שהעמוד והמייל לא יכולים להיפרד. `SECURITY INVOKER` כדי שהיקף המחלקה
  יחול על קריאות מהאפליקציה.
- Edge Function `agent-targets-report` (+ `email.ts` נפרד לתבנית, כדי
  שניתן יהיה לרנדר ולבדוק אותה לבד). `{"force":true}` שולח מייל מבחן.
- `20260802110000_schedule_agent_targets_report.sql` — **טרם הוחל**.
  ה-cron רץ ב-12:30 וב-13:30 UTC כי ל-pg_cron אין אזור זמן ו-15:30
  בירושלים הוא 12:30 בקיץ ו-13:30 בחורף; הפונקציה מדלגת לפני שעת היעד
  או אם כבר נשלח היום, כך שאין כפילות ואין תחזוקת DST.
- `jerusalemDayBounds` הוכלל ל-`jerusalemInstant(date, time)` ב-
  `israel-time.ts` במקום שכפול הלוגיקה.
- קבצים: `src/lib/agent-targets.ts`, `src/lib/israel-time.ts`,
  `src/app/api/agent-targets/route.ts`,
  `src/app/api/settings/agent-targets/route.ts`,
  `src/components/agent-targets-settings.tsx`,
  `src/components/agent-targets-page.tsx`,
  `src/app/agent-targets/page.tsx`, `src/lib/app-pages.ts`,
  `src/components/sidebar.tsx`, `src/components/settings-tabs.tsx`,
  `src/lib/agent-targets.test.ts`.

---

## [2026-07-30] — צמצום סערת הבקשות מ-/calls ו-/agents (שורש ה-403)

### תשתית — עומס שגרם לחסימת IP ב-LiteSpeed
- אובחן: הדומיין `zend-shirot.rc-info.org` (Hostinger hcdn → LiteSpeed
  ב-31.97.121.216) תקין לחלוטין; דף ה-403 מוגש **לפי IP** ע"י הגנת
  ההצפה של LiteSpeed, לפני האפליקציה.
- הסיבה: `useDashboardData` ב-`section-pages.tsx` נקרא ללא טווח ב-/calls
  וב-/agents, כלומר ברירת המחדל של ה-API (31 יום ≈ 12,000 שורות, עד 14
  שאילתות DB), ונשלף **כל 15 שניות + בכל אירוע Realtime בודד** בכל טאב
  פתוח. במשרד עם כמה טאבים זה מגיע מ-IP אחד.
- תוקן: טווח ארוך משבוע עובר ל-polling של 60 שניות ובלי Realtime; אירועי
  Realtime בטווח חי מקובצים (debounce 3 שניות) במקום refetch לכל שורה;
  נוסף רצף בקשות (requestId) שמונע דריסת תגובה חדשה בישנה; `/agents`
  מבקש טווח של היום בלבד במקום 31 יום (הוא כלל לא משתמש בשיחות);
  טבלת היסטוריית השיחות מוגבלת ל-500 שורות ב-DOM עם ציון מפורש,
  ו-`truncated` מוצג גם שם.
- קבצים: `src/components/section-pages.tsx`.

---

## [2026-07-30] — האצת שבוע/חודש בעמוד ניטור בזמן אמת

### ביצועים — טעינה ורינדור של טווחים ארוכים
- **API** (`/api/dashboard`): עמודי השיחות נטענים כעת במקבצים מקבילים של 4
  במקום 12 קריאות עוקבות — טעינת חודש ירדה מ-12 סבבי רשת ל-3. נשמר מסלול
  סדרתי כ-fallback אם `db-max-rows` יוגדר אי-פעם מתחת לגודל עמוד.
- **דשבורד**: הוסר טיימר גלובלי שרינדר מחדש את כל העמוד כל שנייה (כולל
  טבלה של אלפי שורות בטווח חודש — זה מה שהקפיא את הדף). שעוני "זמן שחלף"
  הם עכשיו קומפוננטת `Elapsed` עצמאית שמרנדרת רק את עצמה.
- הטבלה ממקסמת 500 שורות ב-DOM (החיפוש עדיין סורק את כל הטווח) ומוצגת
  הערה כשמדובר בפרוסה חלקית / טווח שנחתך ב-12,000.
- טווח ארוך משבוע: polling כל 60 שניות במקום 15, ובלי רענון Realtime על
  כל אירוע שיחה — גם חוויית שימוש וגם הורדת עומס מהשרת (אותו דפוס עומס
  שהפעיל את חסימת ה-403 של LiteSpeed).
- lint: הוחרג `.deploy-payloads/` (קבצי עזר מקומיים); תוקן דפוס
  setState-in-effect בטעינת היסטוריה ב-agent-ai-analysis.
- קבצים: `src/app/api/dashboard/route.ts`,
  `src/components/dashboard-client.tsx`,
  `src/app/agent-ai-analysis/agent-ai-analysis-client.tsx`,
  `eslint.config.mjs`.

---

## [2026-07-30] — אבחון 403 בפרודקשן, תיעוד אחסון אמיתי, הקשחת RLS מחלקתי

### אבחון תקלה (ללא שינוי קוד אפליקציה)
- אומת שהפרודקשן רץ על **Hostinger/LiteSpeed (31.97.121.216)** ולא על Vercel,
  ושאין שום auto-deploy מ-GitHub — לכן תיקון הסינון (`7b4f36b`) **טרם פרוס**.
  דף ה-403 שהמשתמשים רואים הוא דף ברירת המחדל של LiteSpeed (הגנת עומס לפי IP),
  ותואם לסערת הבקשות שיצרה הרגרסיה של הפדפוד. פירוט ב-`PROJECT_CONTEXT.md`.
- כשל `gemini_empty_response` של מור אלקיים פוענח: `PROHIBITED_CONTENT` על
  אודיו של שיחה אחת (3999276611). v15 דילג עליה והדוח ל-28.07 הושלם (46 שיחות,
  ציון 7, skipped=1) — אין צורך בהרצה חוזרת.

### אבטחה — הקשחת RLS מחלקתי (הופעל)
- מיגרציה `20260730200000_department_scoped_rls.sql` סוגרת את
  `using (true)` על calls / call_legs / call_recordings / agents /
  agent_live_status / agent_status_history ומחליפה במדיניות לפי מחלקת
  המשתמש (זהה ל-`department-scope.ts`). **הופעלה מול Supabase החי
  ב-2026-07-30** ואומתה ב-SQL בסימולציית תפקידים: צופה משויך רואה רק את
  מחלקתו (0 דליפות שיחות/נציגים), אדמין ומנהל ללא מחלקה רואים הכל.
  נותר להמשך: `queue_snapshots`, `zendesk_customers`.

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
