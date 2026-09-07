type StudentPreviewPageProps = { params: Promise<{ assessmentId: string }> };

export default async function StudentPreviewPage({ params }: StudentPreviewPageProps) {
  const { assessmentId } = await params;
  return (
    <main id="main" className="workspace-shell">
      <h1>תצוגת תלמיד</h1>
      <p>דף עבודה: מִבְחָן Grade 8</p>
      <p>קראו את המשפט וסמנו נשוא.</p>
      <p>
        <bdi>{assessmentId}</bdi>
      </p>
    </main>
  );
}
