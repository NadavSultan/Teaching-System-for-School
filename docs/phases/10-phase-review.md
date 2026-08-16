# Phase Review — Phase 10: Secure Foundation and Contracts

תאריך: 2026-08-16  
Commit/tag שנבדק: לא קיים — התיקייה אינה Git repository  
ראיות שנבדקו: דוח המימוש, קוד המקור, migrations, בדיקות, CI, README ו־runbooks; הרצה עצמאית של quality gates ללא PostgreSQL.

## 1. השלמת היעד

השלד המודולרי, גבולות web/API/worker, חוזי runtime, מודל זהות/ארגון בסיסי, fake `ModelGateway`, מעטפת RTL, observability בסיסי ו־CI הוקמו באופן מהותי ובהתאם לכיוון המאושר.

היעד לא הושלם במלואו: שכבת PostgreSQL, שהיא חלק מרכזי מ־Phase 10, לא הופעלה. לכן migrations, בידוד בין דיירים, transaction של Personal Workspace ועיבוד outbox אינם מוכחים. בנוסף, סקירת הקוד מצאה פערים באינווריאנט החברות, בהרשאות mutation ובכיסוי חוזי JSON Schema.

## 2. קריטריוני קבלה

|   # | סטטוס        | ראיות ומסקנה                                                                                                                                                    | תיקון נדרש                                                                                                                      |
| --: | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
|   1 | PARTIAL      | התקנה קפואה ותיעוד קיימים; PostgreSQL מקומי נקי לא הופעל.                                                                                                       | להפעיל setup נקי מתועד עם PostgreSQL.                                                                                           |
|   2 | PASS         | שלושת היישומים נבנים בנפרד; `pnpm build` עבר.                                                                                                                   | —                                                                                                                               |
|   3 | PARTIAL      | format, lint, typecheck, 19 unit tests ו־build עברו; integration command סיים 0 אך דילג על 6 בדיקות DB. אין לראות skip כהצלחה מלאה.                             | להריץ את כל בדיקות האינטגרציה ללא skips.                                                                                        |
|   4 | PARTIAL      | workflow קיים ומכיל PostgreSQL והפקודות הנדרשות, אך לא הורץ. שלב “new schema” רק מריץ שוב על אותו DB ואינו בודק schema חדש בפועל.                               | לתקן את שם/התנהגות של שלב ה־migration ולהציג ריצת CI או הרצה שקולה נקייה.                                                       |
|   5 | NOT VERIFIED | migration ו־readiness קיימים אך לא הופעלו מול PostgreSQL.                                                                                                       | apply על DB נקי + readiness מוצלח, ולתעד פקודות/תוצאות.                                                                         |
|   6 | PARTIAL      | הטבלאות והאילוצים העיקריים קיימים בקוד SQL. DB לא אימת אותם; בנוסף “exactly one active member” אינו נאכף—הטריגר מונע יותר מאחד אך מאפשר אפס.                    | לתקן/לדייק את האינווריאנט ולהריץ בדיקות DB.                                                                                     |
|   7 | NOT VERIFIED | transaction סריאליזבילי ובדיקת concurrency קיימים אך דולגו.                                                                                                     | להריץ retry/concurrency מול PostgreSQL ולוודא שאין orphan organizations.                                                        |
|   8 | NOT VERIFIED | בדיקת בידוד דו־כיוונית קיימת אך דולגה. זהו release gate.                                                                                                        | להריץ read/mutation isolation מול API ו־DB אמיתיים.                                                                             |
|   9 | PARTIAL      | unit policy מכסה inactive/role denial; הנתיב המלא דולג. מדיניות mutation אינה operation-specific ומאפשרת `TEACHER` לשנות שם גם ל־SCHOOL workspace.              | להגדיר הרשאות נפרדות לקריאה ולשינוי ולבדוק PERSONAL/SCHOOL roles.                                                               |
|  10 | PASS         | dev/test auth נחסם ב־production ו־managed mode נכשל סגור.                                                                                                       | —                                                                                                                               |
|  11 | PARTIAL      | liveness, request ID, headers, size ו־CORS עברו; readiness DB לא הופעל. בדיקת “malformed authentication” בוחנת למעשה header ארגון חסר ומקבלת 400, לא אימות 401. | להוסיף בדיקת unauthenticated אמיתית ולהפעיל readiness בשני המצבים.                                                              |
|  12 | PASS         | בדיקות redaction עברו וה־request logger אינו רושם headers/body.                                                                                                 | —                                                                                                                               |
|  13 | PASS         | בדיקות RTL/mixed direction ו־production build עברו.                                                                                                             | —                                                                                                                               |
|  14 | PASS         | ארבע בדיקות גבולות imports עברו.                                                                                                                                | —                                                                                                                               |
|  15 | PASS         | קיים fake gateway דטרמיניסטי בלבד ואין provider SDK.                                                                                                            | —                                                                                                                               |
|  16 | NOT VERIFIED | קוד worker ובדיקה קיימים, אך הבדיקה דולגה. אין הוכחת retry של handler כושל או recovery מאירוע שנותר `PROCESSING`.                                               | להריץ; להוסיף handler כושל ניתן לבדיקה ומדיניות recovery מינימלית או לתעד במפורש את מגבלת crash recovery כחוב לפני שימוש אמיתי. |
|  17 | PARTIAL      | בדיקות Zod וסנכרון שני snapshots עברו. חסרים JSON Schemas עבור workspace context, organization, membership ו־API error—חוזים שחוצים web/API.                    | להפיק snapshots לכל החוזים החיצוניים ולבדוק drift.                                                                              |
|  18 | PASS         | לא הופעל שירות ענן/בתשלום ולא נמצאו credentials אמיתיים בקבצים שנבדקו.                                                                                          | —                                                                                                                               |
|  19 | PARTIAL      | התיעוד טוב ברובו, אך מציג `exactly one` כאכיפה קיימת ומציג CI migration step באופן מטעה.                                                                        | לעדכן לאחר תיקוני הקוד והבדיקות.                                                                                                |
|  20 | PASS         | לא הוכנסה פונקציונליות של Phase 20 ומעלה.                                                                                                                       | —                                                                                                                               |

## 3. תאימות לארכיטקטורה

התכנון המודולרי והפרדת התלויות תואמים ל־ADR-002, בסיס הדיירים תואם ל־ADR-006, וגבול ה־AI תואם ל־ADR-007. אין architectural drift שמצדיק פתיחת הארכיטקטורה מחדש.

פערים:

- הרשאות קריאה וכתיבה חולקות policy ברירת־מחדל רחב מדי. זה coupling בין “חברות בארגון” לבין “הרשאה לשנות ארגון”.
- האינווריאנט המתועד `exactly one active member` אינו תואם לאכיפה בפועל (`at most one`). יש לבחור ניסוח/מדיניות אחת וליישמה באופן עקבי.
- חוזי Zod קיימים, אך לא כל חוזי web/API מקבלים artifact של JSON Schema ו־drift test כפי שנדרש.
- `dist` ו־`.next` קיימים מקומית אך מוחרגים ב־`.gitignore`; אין לראות בהם source artifacts. מאחר שאין Git repository, אין עדיין commit מזוהה לסקירות עתידיות.

## 4. השפעת אינטגרציה

- Phase 20 תלוי ישירות באמינות migrations, ownership, authorization וחוזים; אין להוסיף Curriculum/Assessment לפני סגירתם.
- אין שינוי ב־Curriculum, Knowledge או Assessment schema versions; כולם טרם הוקמו.
- גבול ה־AI נשמר ואין עלות API או תלות בספק.
- deployment טרם החל; CI קיים אך לא אומת בפלטפורמת GitHub.
- תיקוני Phase 10 צריכים להיות ממוקדים ואינם דורשים redesign.

## 5. בדיקות ו־QA

הרצה עצמאית עם Node `24.19.0`:

- `pnpm format-check` — עבר.
- `pnpm lint` — עבר.
- `pnpm typecheck` — 9/9 targets עברו.
- `pnpm test` — 8 files, 19 tests עברו.
- `pnpm test-integration` — 1 file עבר, 2 files דולגו; 4 tests עברו ו־6 דולגו.
- `pnpm test:architecture` — 4/4 עברו.
- `pnpm contracts:check` — 1/1 עבר.
- `pnpm build` — 9/9 targets עברו, כולל Next.js production build.
- `pnpm audit` — לא אומת עקב חסימת רשת בסביבה; אין להסיק מכך שאין vulnerabilities.

הכשל הראשון ללא Node ב־PATH היה סביבתי ותוקן באמצעות runtime המצורף; הוא אינו defect במאגר. PostgreSQL/Docker אינם זמינים בסביבת הסקירה ולכן אין ראיית DB עצמאית.

## 6. עדכון חוב טכני

נרשמו TD-001 עד TD-007 ב־`technical-debt-register.md`. TD-001 עד TD-004 הם Critical וחייבים להיסגר לפני Phase 20.

## 7. עדכון Decision Log

לא נדרש ADR חדש. אין שינוי ב־ADR-001 עד ADR-007. יש ליישם הרשאות operation-specific בתוך ADR-006, לא לשנות אותו.

## 8. עדכון Risk Register

R-004 (דליפה בין דיירים) נשאר פתוח ולא הופחת, משום שבדיקות הבידוד דולגו. נוספו R-011 (תאימות/supply chain) ו־R-012 (drift בין invariants מתועדים לאכיפת DB/application).

## 9. מצב התיעוד

ה־README וה־runbooks מספקים בסיס טוב לסשן חדש. נדרשים תיקונים לטענת `exactly one`, לשלב “new schema” ב־CI ולדוח המימוש לאחר הרצת PostgreSQL. יש לאתחל Git ולספק commit hash לפני הסקירה החוזרת כדי לאפשר traceability אמין.

## 10. פסק דין

**REQUIRES FIXES – Do not proceed yet**

השלד איכותי ותואם לארכיטקטורה, אך אי אפשר לאשר foundational security/data behavior שמעולם לא הופעל. בידוד דיירים הוא שער אבטחה, לא follow-up אופציונלי. בנוסף, פערי האינווריאנט, הרשאות ה־mutation וחוזי ה־JSON Schema צריכים להיסגר כעת, לפני ש־Phase 20 בונה עליהם.

### תנאים לסקירה חוזרת

1. PostgreSQL זמין בסביבת המימוש; migration מוחל על DB נקי וכל 10 בדיקות האינטגרציה רצות ללא skips.
2. readiness נבדק במצב DB זמין ולא זמין.
3. שתי בדיקות בידוד דיירים דו־כיווניות עוברות דרך HTTP וה־DB, כולל read ו־mutation.
4. מדיניות Personal Workspace מתוקנת או מנוסחת מחדש בעקביות, עם בדיקות לאפס/אחד/יותר מחבר פעיל.
5. rename/mutation משתמש בהרשאה operation-specific; Teacher אינו מקבל הרשאת SCHOOL admin בטעות.
6. outbox failure/retry ו־stale `PROCESSING` מקבלים בדיקה ומדיניות מינימלית התואמת את טענת durability.
7. כל חוזי web/API החיצוניים מקבלים JSON Schema snapshots ובדיקת drift.
8. CI migration verification מדויק; Git repository מאותחל ונוצר commit שניתן לסקור.
9. דוח המימוש, README וה־runbooks מעודכנים עם פקודות, תוצאות וסטטוסים חדשים.
