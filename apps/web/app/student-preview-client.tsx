'use client';

import { useEffect, useState } from 'react';
import type { z } from '@teach/contracts';
import { teacherApi } from './teacher-api';

type Preview = z.infer<typeof import('@teach/contracts').studentSafePreviewSchema>;

export function StudentPreviewClient({
  assessmentId,
  revisionId,
}: {
  assessmentId: string;
  revisionId: string;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    void teacherApi
      .preview(assessmentId, revisionId)
      .then(setPreview)
      .catch(() => setError('התצוגה אינה זמינה עד לאישור הגרסה.'));
  }, [assessmentId, revisionId]);
  if (error)
    return (
      <main id="main" className="workspace-shell">
        <p role="alert">{error}</p>
      </main>
    );
  if (!preview)
    return (
      <main id="main" className="workspace-shell">
        <p aria-live="polite">טוען תצוגת תלמיד…</p>
      </main>
    );
  return (
    <main id="main" className="workspace-shell">
      <h1>{preview.title}</h1>
      {preview.sections.map((section) => (
        <section key={`${section.order}-${section.title}`}>
          <h2>{section.title}</h2>
          {section.questions.map((question) => (
            <article key={question.logicalId}>
              <h3>שאלה {question.order + 1}</h3>
              <p>{question.prompt}</p>
              {question.instructions && <p>{question.instructions}</p>}
            </article>
          ))}
        </section>
      ))}
    </main>
  );
}
