import Link from 'next/link';
import { WorkspaceClient } from '../../workspace-client';

export default async function AssessmentPage({
  params,
}: {
  params: Promise<{ assessmentId: string }>;
}) {
  const { assessmentId } = await params;
  return (
    <>
      <WorkspaceClient assessmentId={assessmentId} readOnly />
      <p className="workspace-shell">
        <Link href={`/assessments/${assessmentId}/edit`}>פתיחת גרסה לעריכה</Link>
      </p>
    </>
  );
}
