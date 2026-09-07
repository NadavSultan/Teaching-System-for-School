import { StudentPreviewClient } from '../../../student-preview-client';

export default async function StudentPreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ assessmentId: string }>;
  searchParams: Promise<{ revisionId?: string }>;
}) {
  const [{ assessmentId }, { revisionId }] = await Promise.all([params, searchParams]);
  if (!revisionId)
    return (
      <main id="main" className="workspace-shell">
        <p role="alert">חסרה גרסת הערכה לתצוגה.</p>
      </main>
    );
  return <StudentPreviewClient assessmentId={assessmentId} revisionId={revisionId} />;
}
