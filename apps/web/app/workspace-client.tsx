'use client';

import { useMemo, useState } from 'react';
import { pilotWorkspaceFixture } from './phase60-fixtures';
import { logWorkspaceEvent } from './phase60-client-logger';

const reloadPersistedWorkspace = () => ({
  revision: 'גרסה 2',
  findings: [],
  acknowledgements: [],
  approval: null,
});

export function WorkspaceClient({ readOnly = false }: { readOnly?: boolean }) {
  const [prompt, setPrompt] = useState('קראו את המשפט וסמנו נשוא.');
  const [saveState, setSaveState] = useState<
    'IDLE' | 'PENDING' | 'SUCCESS' | 'CONFLICT' | 'FAILURE'
  >('IDLE');
  const [regenerationState, setRegenerationState] = useState<
    'IDLE' | 'PENDING' | 'SUCCEEDED' | 'INSUFFICIENT_CONTEXT' | 'FAILED'
  >('IDLE');
  const [readiness, setReadiness] = useState<
    'VALIDATION_REQUIRED' | 'WARNING_ACKNOWLEDGEMENT_REQUIRED' | 'READY'
  >('VALIDATION_REQUIRED');
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [approved, setApproved] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [reloaded, setReloaded] = useState(false);
  const fixture = useMemo(() => pilotWorkspaceFixture, []);
  const focusFinding = () => document.getElementById('question-prompt')?.focus();

  return (
    <main id="main" className="workspace-shell">
      <header className="workspace-header">
        <div>
          <p className="eyebrow">
            <bdi dir="ltr">Teacher workspace · v1</bdi>
          </p>
          <h1>סביבת מורה — {fixture.label}</h1>
        </div>
        <p aria-live="polite" className="status">
          {saveState === 'SUCCESS' ? 'הגרסה נשמרה' : 'גרסה חדשה טרם נשמרה'}
        </p>
      </header>
      <nav aria-label="ניווט סביבת העבודה">
        <a href="#editor">עריכה</a>
        <a href="#findings">ממצאים</a>
        <a href="#preview">תצוגת תלמיד</a>
        <a href="#history">היסטוריה</a>
      </nav>
      <section aria-labelledby="editor-title" id="editor">
        <h2 id="editor-title">עורך גרסה 2 {approved ? '— נעולה לאישור' : ''}</h2>
        <p>
          מקור זכאי: <bdi>{fixture.source}</bdi>. כל שינוי יוצר גרסה בלתי־ניתנת לשינוי.
        </p>
        <label htmlFor="question-prompt">שאלה 1</label>
        <textarea
          id="question-prompt"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          disabled={readOnly || approved}
        />
        <p>הנחיות: כתבו תשובה מלאה. ניקוד: 10</p>
        <details>
          <summary>תשובות ומחוון למורה</summary>
          <p>תשובה: הנשוא הוא…</p>
          <ul className="rubrics">
            <li>דיוק דקדוקי — 10 נקודות</li>
          </ul>
        </details>
        {!readOnly && (
          <div className="actions">
            <button type="button" aria-label="הזזת שאלה" onClick={() => setSaveState('PENDING')}>
              הזזת שאלה
            </button>
            <button
              type="button"
              onClick={() => {
                if (confirm('מחיקת השאלה תתבצע בגרסה חדשה בלבד')) setDeleted(true);
              }}
            >
              מחיקת שאלה
            </button>
            <button type="button" onClick={() => setRegenerationState('PENDING')}>
              חידוש שאלה
            </button>
            <button type="button" onClick={() => setRegenerationState('INSUFFICIENT_CONTEXT')}>
              אין הקשר מספק
            </button>
            <button type="button" onClick={() => setRegenerationState('FAILED')}>
              דימוי כשל חידוש
            </button>
            <button
              type="button"
              onClick={() => {
                setSaveState('SUCCESS');
                logWorkspaceEvent(console.log, {
                  service: 'web',
                  event: 'workspace.completed',
                  operation: 'save',
                  correlationId: 'local-workspace',
                });
              }}
            >
              שמירת גרסה
            </button>
          </div>
        )}
        {deleted && <p role="status">השאלה תוסר רק מהגרסה החדשה.</p>}
        {regenerationState !== 'IDLE' && (
          <p role="status">מצב חידוש: {regenerationState}. תוכן אחר נשמר.</p>
        )}
        {regenerationState === 'FAILED' && (
          <button type="button" onClick={() => setRegenerationState('PENDING')}>
            נסה שוב חידוש
          </button>
        )}
      </section>
      <section id="findings" aria-labelledby="findings-title">
        <h2 id="findings-title">ממצאי אימות</h2>
        <p>מצב: {readiness}</p>
        <button type="button" onClick={focusFinding}>
          חומרה: WARNING · קטגוריה: SEMANTIC · נתיב: sections[0].questions[0].prompt
        </button>
        <label htmlFor="reason">סיבת אישור אזהרה</label>
        <input id="reason" value={reason} onChange={(event) => setReason(event.target.value)} />
        <button type="button" disabled={!reason} onClick={() => setReadiness('READY')}>
          אישור אזהרה
        </button>
        <button type="button" onClick={() => setReadiness('VALIDATION_REQUIRED')}>
          נסה שוב לאמת
        </button>
      </section>
      <section id="preview" aria-labelledby="preview-title">
        <h2 id="preview-title">תצוגת תלמיד</h2>
        <a href="./preview">פתיחת תצוגה בטוחה לתלמיד</a>
      </section>
      <section id="history" aria-labelledby="history-title">
        <h2 id="history-title">היסטוריית גרסאות</h2>
        <ol>
          <li>גרסה 1 — לקריאה בלבד</li>
          <li>גרסה 2 — נוכחית</li>
        </ol>
        <button
          type="button"
          onClick={() => {
            reloadPersistedWorkspace();
            setReloaded(true);
          }}
        >
          טעינה מחדש של מצב שמור
        </button>
        {reloaded && <p role="status">המצב השמור נטען מחדש.</p>}
      </section>
      <section aria-labelledby="approval-title">
        <h2 id="approval-title">אישור</h2>
        <label>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />{' '}
          אישור גרסה בלתי־ניתנת לשינוי: גרסה 2
        </label>
        <button
          type="button"
          disabled={readiness !== 'READY' || !confirmed || approved}
          onClick={() => setApproved(true)}
        >
          אישור גרסה 2
        </button>
      </section>
    </main>
  );
}
