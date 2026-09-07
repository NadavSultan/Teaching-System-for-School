'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { z } from '@teach/contracts';
import { teacherApi } from '../teacher-api';

type List = z.infer<typeof import('@teach/contracts').teacherAssessmentListResponseSchema>;

export default function AssessmentsPage() {
  const [list, setList] = useState<List | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    void teacherApi
      .list()
      .then(setList)
      .catch(() => setError('לא ניתן לטעון הערכות שמורות.'));
  }, []);
  return (
    <main id="main" className="workspace-shell">
      <h1>הערכות</h1>
      {error && <p role="alert">{error}</p>}
      {!list && !error && <p aria-live="polite">טוען הערכות…</p>}
      {list?.items.length === 0 && <p>אין עדיין הערכות</p>}
      {list && list.items.length > 0 && (
        <ol>
          {list.items.map((assessment) => (
            <li key={assessment.id}>
              <Link href={`/assessments/${assessment.id}`}>
                {assessment.title} — גרסה {assessment.latestRevisionNumber ?? 'טרם נוצרה'}
              </Link>
            </li>
          ))}
        </ol>
      )}
      <Link href="/assessments/new">יצירת הערכה חדשה</Link>
    </main>
  );
}
