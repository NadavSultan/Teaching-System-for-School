const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export default function Home() {
  const development = process.env.NODE_ENV !== 'production';
  return (
    <main id="main" className="shell">
      <header>
        <p className="eyebrow">Phase 10</p>
        <h1>סביבת ההוראה</h1>
      </header>
      <section aria-labelledby="workspace-heading">
        <h2 id="workspace-heading">הקשר סביבת העבודה</h2>
        {development ? (
          <div className="notice" role="note">
            <strong>כניסת פיתוח בלבד</strong>
            <p>
              מנגנון זה אינו אימות למערכת ייצור. ה-API זמין בכתובת <bdi>{apiUrl}</bdi>.
            </p>
          </div>
        ) : (
          <p>יש להתחבר באמצעות ספק האימות המנוהל.</p>
        )}
        <dl>
          <div>
            <dt>שפה</dt>
            <dd>עברית</dd>
          </div>
          <div>
            <dt>מזהה טכני</dt>
            <dd>
              <code dir="ltr">workspace_demo_01</code>
            </dd>
          </div>
        </dl>
        <p>
          טקסט מעורב לדוגמה: כיתה <bdi>Grade 8 / API-v1</bdi> מוכנה.
        </p>
      </section>
    </main>
  );
}
