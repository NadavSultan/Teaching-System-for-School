'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { z } from '@teach/contracts';
import { logWorkspaceEvent } from './phase60-client-logger';
import { TeacherApiError, teacherApi } from './teacher-api';

type Workspace = z.infer<typeof import('@teach/contracts').teacherWorkspaceSchema>;
type ValidationResult = z.infer<typeof import('@teach/contracts').validationResultSchema>;
type LoadState = 'LOADING' | 'READY' | 'ERROR';
const key = () => crypto.randomUUID();
const errorMessage = (error: unknown) =>
  error instanceof TeacherApiError ? `${error.code}: ${error.message}` : 'טעינת הנתונים נכשלה.';

function editorRequest(workspace: Workspace, prompt: string) {
  return {
    version: '1.0.0' as const,
    assessmentId: workspace.assessment.id,
    baseRevisionId: workspace.revision.id,
    baseRevisionNumber: workspace.revision.revisionNumber,
    idempotencyKey: key(),
    sections: workspace.revision.sections.map((section, sectionIndex) => ({
      key: section.key,
      title: section.title,
      instructions: section.instructions,
      order: section.order,
      scoreUnits: section.scoreUnits,
      questions: section.questions.map((question, questionIndex) => ({
        logicalId: question.logicalId,
        key: question.key,
        type: question.type,
        prompt: sectionIndex === 0 && questionIndex === 0 ? prompt : question.prompt,
        instructions: question.instructions,
        order: question.order,
        scoreUnits: question.scoreUnits,
        answers: question.answers.map(({ key: answerKey, order, text, explanation }) => ({
          key: answerKey,
          order,
          text,
          explanation,
        })),
        rubrics: question.rubrics.map(({ key: rubricKey, order, description, scoreUnits }) => ({
          key: rubricKey,
          order,
          description,
          scoreUnits,
        })),
        subQuestions: question.subQuestions.map((subQuestion) => ({
          key: subQuestion.key,
          prompt: subQuestion.prompt,
          order: subQuestion.order,
          scoreUnits: subQuestion.scoreUnits,
          answers: subQuestion.answers.map(({ key: answerKey, order, text, explanation }) => ({
            key: answerKey,
            order,
            text,
            explanation,
          })),
          rubrics: subQuestion.rubrics.map(
            ({ key: rubricKey, order, description, scoreUnits }) => ({
              key: rubricKey,
              order,
              description,
              scoreUnits,
            }),
          ),
        })),
      })),
    })),
  };
}

export function WorkspaceClient({
  assessmentId,
  readOnly = false,
}: {
  assessmentId: string;
  readOnly?: boolean;
}) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('LOADING');
  const [message, setMessage] = useState('');
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(
    async (revisionId?: string) => {
      setLoadState('LOADING');
      try {
        const reloaded = await teacherApi.workspace(assessmentId, revisionId);
        setWorkspace(reloaded);
        setValidation(
          reloaded.validation ? await teacherApi.validationResult(reloaded.validation.id) : null,
        );
        setLoadState('READY');
        setMessage('המצב השמור נטען מחדש מהשרת.');
      } catch (error) {
        setLoadState('ERROR');
        setMessage(errorMessage(error));
      }
    },
    [assessmentId],
  );
  useEffect(() => {
    void reload();
  }, [reload]);

  const firstQuestion = workspace?.revision.sections[0]?.questions[0];
  const [draftPrompt, setDraftPrompt] = useState('');
  useEffect(
    () => setDraftPrompt(firstQuestion?.prompt ?? ''),
    [firstQuestion?.id, firstQuestion?.prompt],
  );
  const isLocked = Boolean(workspace?.approval.approved) || readOnly;
  const acknowledgeable = useMemo(
    () =>
      validation?.findings.find(
        (finding) => finding.kind === 'SEMANTIC' && finding.severity === 'WARNING',
      ),
    [validation],
  );
  async function run(
    operation: 'save' | 'regenerate' | 'validation' | 'approval',
    work: () => Promise<void>,
  ) {
    setBusy(operation);
    try {
      await work();
      logWorkspaceEvent(console.info, {
        service: 'web',
        event: 'workspace.completed',
        operation,
        correlationId: key(),
      });
    } catch (error) {
      setMessage(errorMessage(error));
      logWorkspaceEvent(console.error, {
        service: 'web',
        event: 'workspace.failed',
        operation,
        correlationId: key(),
      });
    } finally {
      setBusy(null);
    }
  }

  if (loadState === 'LOADING' && !workspace)
    return (
      <main id="main" className="workspace-shell">
        <p aria-live="polite">טוען סביבת עבודה שמורה…</p>
      </main>
    );
  if (!workspace)
    return (
      <main id="main" className="workspace-shell">
        <p role="alert">{message}</p>
        <button type="button" onClick={() => void reload()}>
          נסה שוב
        </button>
      </main>
    );

  return (
    <main id="main" className="workspace-shell">
      <header className="workspace-header">
        <div>
          <p className="eyebrow">
            <bdi dir="ltr">Teacher workspace · persisted API</bdi>
          </p>
          <h1>סביבת מורה — {workspace.assessment.title}</h1>
        </div>
        <p aria-live="polite" className="status">
          {message || `גרסה ${workspace.revision.revisionNumber} נשמרה`}
        </p>
      </header>
      <nav aria-label="ניווט סביבת העבודה">
        <a href="#editor">עריכה</a>
        <a href="#findings">ממצאים</a>
        <a href="#preview">תצוגת תלמיד</a>
        <a href="#history">היסטוריה</a>
      </nav>
      <section aria-labelledby="editor-title" id="editor">
        <h2 id="editor-title">
          עורך גרסה {workspace.revision.revisionNumber}
          {isLocked ? ' — נעולה לאישור' : ''}
        </h2>
        {workspace.revision.sections.map((section, sectionIndex) => (
          <div key={section.id}>
            <h3>{section.title}</h3>
            {section.questions.map((question, questionIndex) => (
              <article key={question.id}>
                <label htmlFor={`question-${question.id}`}>שאלה {question.order + 1}</label>
                <textarea
                  id={`question-${question.id}`}
                  value={sectionIndex === 0 && questionIndex === 0 ? draftPrompt : question.prompt}
                  onChange={(event) => setDraftPrompt(event.target.value)}
                  disabled={isLocked || !(sectionIndex === 0 && questionIndex === 0)}
                />
                <p>ניקוד: {question.scoreUnits ?? 'ללא ניקוד'}</p>
                <details>
                  <summary>תשובות ומחוון למורה</summary>
                  <ul>
                    {question.answers.map((answer) => (
                      <li key={answer.id}>{answer.text}</li>
                    ))}
                    {question.rubrics.map((rubric) => (
                      <li key={rubric.id}>{rubric.description}</li>
                    ))}
                  </ul>
                </details>
              </article>
            ))}
          </div>
        ))}
        {!isLocked && (
          <div className="actions">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() =>
                void run('save', async () => {
                  const saved = await teacherApi.save(editorRequest(workspace, draftPrompt));
                  await reload(saved.revisionId);
                })
              }
            >
              שמירת גרסה
            </button>
            <button
              type="button"
              disabled={busy !== null || !firstQuestion}
              onClick={() =>
                void run('regenerate', async () => {
                  const status = await teacherApi.regenerate({
                    version: '1.0.0',
                    assessmentId,
                    baseRevisionId: workspace.revision.id,
                    logicalQuestionId: firstQuestion!.logicalId,
                    idempotencyKey: key(),
                  });
                  await teacherApi.regenerationResult(status.id);
                  setMessage(`חידוש שאלה: ${status.state}`);
                })
              }
            >
              חידוש שאלה
            </button>
          </div>
        )}
      </section>
      <section id="findings" aria-labelledby="findings-title">
        <h2 id="findings-title">ממצאי אימות</h2>
        <p>
          מצב מוכנות: {workspace.readiness.status}
          {workspace.readiness.reasonCode ? ` · ${workspace.readiness.reasonCode}` : ''}
        </p>
        {validation?.findings.map((finding) => (
          <p key={finding.id}>
            <button
              type="button"
              onClick={() => document.getElementById(`question-${firstQuestion?.id}`)?.focus()}
            >
              חומרה: {finding.severity} · קטגוריה: {finding.category} · נתיב: {finding.path}
            </button>
          </p>
        ))}
        {!isLocked && (
          <>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() =>
                void run('validation', async () => {
                  await teacherApi.validate({
                    version: '1.0.0',
                    assessmentId,
                    assessmentRevisionId: workspace.revision.id,
                    idempotencyKey: key(),
                  });
                  await reload(workspace.revision.id);
                })
              }
            >
              הפעלת אימות
            </button>
            {acknowledgeable && (
              <>
                <label htmlFor="reason">סיבת אישור אזהרה</label>
                <input
                  id="reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
                <button
                  type="button"
                  disabled={!reason || busy !== null}
                  onClick={() =>
                    void run('validation', async () => {
                      await teacherApi.acknowledge({
                        version: '1.0.0',
                        findingId: acknowledgeable.id,
                        reason,
                        idempotencyKey: key(),
                      });
                      await reload(workspace.revision.id);
                    })
                  }
                >
                  אישור אזהרה
                </button>
              </>
            )}
          </>
        )}
      </section>
      <section id="preview" aria-labelledby="preview-title">
        <h2 id="preview-title">תצוגת תלמיד</h2>
        <Link href={`/assessments/${assessmentId}/preview?revisionId=${workspace.revision.id}`}>
          פתיחת תצוגה בטוחה לתלמיד
        </Link>
      </section>
      <section id="history" aria-labelledby="history-title">
        <h2 id="history-title">היסטוריית גרסאות</h2>
        <ol>
          {workspace.history.map((revision) => (
            <li key={revision.id}>
              <button type="button" onClick={() => void reload(revision.id)}>
                גרסה {revision.revisionNumber}
                {revision.isLatest ? ' — נוכחית' : ''}
              </button>
            </li>
          ))}
        </ol>
        <button type="button" onClick={() => void reload()}>
          טעינה מחדש של מצב שמור
        </button>
      </section>
      <section aria-labelledby="approval-title">
        <h2 id="approval-title">אישור</h2>
        <label>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            disabled={isLocked}
          />{' '}
          אישור גרסה בלתי־ניתנת לשינוי: גרסה {workspace.revision.revisionNumber}
        </label>
        <button
          type="button"
          disabled={
            workspace.readiness.status !== 'READY' || !confirmed || isLocked || busy !== null
          }
          onClick={() =>
            void run('approval', async () => {
              await teacherApi.approve({
                version: '1.0.0',
                assessmentId,
                assessmentRevisionId: workspace.revision.id,
                idempotencyKey: key(),
              });
              await reload(workspace.revision.id);
            })
          }
        >
          אישור גרסה {workspace.revision.revisionNumber}
        </button>
      </section>
    </main>
  );
}
