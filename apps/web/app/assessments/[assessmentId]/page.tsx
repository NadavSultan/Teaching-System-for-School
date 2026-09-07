import Link from 'next/link';
import { WorkspaceClient } from '../../workspace-client';

export default function AssessmentPage() {
  return (
    <>
      <WorkspaceClient readOnly />
      <p className="workspace-shell">
        <Link href="./edit">פתיחת גרסה לעריכה</Link>
      </p>
    </>
  );
}
