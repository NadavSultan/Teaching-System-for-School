import Link from 'next/link';

export default function AssessmentsPage() {
  return (
    <main id="main" className="workspace-shell">
      <h1>הערכות</h1>
      <p>אין עדיין הערכות</p>
      <Link href="/assessments/new">יצירת הערכה חדשה</Link>
    </main>
  );
}
