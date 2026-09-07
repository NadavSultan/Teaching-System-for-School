import { WorkspaceClient } from '../../../workspace-client';

export default async function EditAssessmentPage({
  params,
}: {
  params: Promise<{ assessmentId: string }>;
}) {
  const { assessmentId } = await params;
  return <WorkspaceClient assessmentId={assessmentId} />;
}
