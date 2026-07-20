# City Live — דשבורד Aircall

דשבורד שיחות חי בעברית וב־RTL עבור מחלקות שירות הלקוחות והאספקות של רהיטי הסיטי. המערכת שומרת את היסטוריית השיחות ב־Supabase, מציגה סטטוס נציגים ותור בזמן אמת ומאפשרת סינון לפי תקופה, מחלקה ונציג.

## מה כלול

- כרטיסי KPI: סך שיחות, נכנסות, יוצאות, נענו, לא נענו, זמן שיחה ממוצע ואחוז מענה.
- טבלת שיחות חיה ופאנל סטטוס נציגים.
- עמוד הקלטות עם נגן מאובטח, סינון לפי מחלקה ונציג והודעות קוליות.
- פילטרים להיום, שבוע, חודש, טווח מותאם, מחלקה ונציג.
- חיבור מאובטח ל־Aircall באמצעות Webhook של Supabase.
- Incremental sync לשיחות ול־call legs, סנכרון משתמשים/קבוצות וקווי Talk.
- Supabase Auth, תפקידי admin/manager/viewer, RLS ו־Realtime.
- מצב הדגמה מלא כאשר Supabase עדיין לא חובר.

> אירועי Aircall נשמרים בזמן אמת ב־Supabase. כתובת ה־Webhook כוללת מפתח סודי ואסור לפרסם אותה.

## הפעלה מקומית

דרישות: Node.js 20 ומעלה ופרויקט Supabase.

```bash
npm install
copy .env.example .env.local
npm run dev
```

ללא משתני Supabase המערכת עולה במצב הדגמה בכתובת `http://localhost:3000/dashboard`.

## הקמת Supabase

1. צרו פרויקט חדש ב־Supabase.
2. העתיקו את Project URL ואת ה־Publishable key אל `.env.local`. אין צורך לחשוף `service_role` לאפליקציית Next.js.
3. החליפו את `NEXT_PUBLIC_DEMO_MODE` ל־`false`.
4. חברו את Supabase CLI והחילו את הסכמה:

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

5. צרו את המשתמש הראשון ממסך הכניסה. המשתמש הראשון מקבל תפקיד `admin` אוטומטית; משתמשים נוספים מקבלים `viewer`.
6. פרסו את פונקציות Aircall:

```bash
npx supabase functions deploy aircall-webhook --no-verify-jwt
npx supabase functions deploy stream-recording --no-verify-jwt
```

7. ה־migration יוצר ב־Vault מפתח Webhook אקראי שאינו נחשף למשתמשים שאינם מנהלים.

## חיבור Aircall

1. היכנסו למערכת כ־admin ופתחו **הגדרות**.
2. העתיקו את כתובת ה־Webhook המאובטחת.
3. ב־Aircall פתחו **Integrations → Webhook**, הזינו שם ואת הכתובת בשדה URL.
4. הפעילו את אירועי השיחות והמשתמשים המומלצים שמופיעים במסך ושמרו.

המערכת קולטת אירועי שיחות, נציגים, מספרים והקלטות בזמן אמת. אירועים כפולים מסוננים אוטומטית.

## מחלקות ושיוך

ה־migration יוצר שתי מחלקות: `שירות לקוחות` ו־`אספקות`. אירועי Aircall משייכים אוטומטית Teams ששמם מכיל את השמות האלה (או Customer Service/Delivery). שיחה שלא נענתה משויכת לפי ה־Team או המספר שלה.

כל הזמנים נשמרים ב־UTC ומוצגים לפי `Asia/Jerusalem`.

## הגדרת המדדים

- **נכנסות שנענו**: שיחות inbound עם `completion_status=completed`.
- **לא נענו**: שיחות inbound שלא הסתיימו כ־completed.
- **אחוז מענה**: נכנסות שנענו חלקי כלל השיחות הנכנסות.
- **זמן שיחה**: `talk_time`, ללא המתנה, hold ו־wrap-up.
- החמצה של נציג ב־call leg אינה הופכת שיחה ללא נענתה אם נציג אחר ענה לה.

## בדיקות ואיכות

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

לפני production מומלץ להריץ ב־Supabase את Database Advisors, לוודא שכל טבלאות `public` מוגנות ב־RLS, ולבדוק את `sync_runs` לאחר סנכרון ראשון.

## פריסה

האפליקציה דורשת סביבת Next.js עם Node (למשל Vercel או Hostinger Node.js), ולא אחסון סטטי. הגדירו בפריסה את אותם משתני `.env.local`. לעולם אין להעלות `.env.local` ל־Git.
