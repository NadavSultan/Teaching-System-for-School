import Link from 'next/link';

const curriculumNodeId = 'persisted-curriculum-node';
export default function NewAssessmentPage() {
  return (
    <main id="main" className="workspace-shell">
      <h1>יצירת הערכה</h1>
      <label>
        סוג
        <select defaultValue="WORKSHEET">
          <option>WORKSHEET</option>
          <option>TEST</option>
        </select>
      </label>
      <label>
        תכנית לימודים
        <select aria-label="תכנית לימודים">
          <option value={curriculumNodeId}>כיתה ח׳ · עברית · תחביר</option>
        </select>
      </label>
      <p>הבחירה נשמרת מהיררכיית תוכנית הלימודים.</p>
      <Link href="/assessments/demo/edit">המשך לעורך</Link>
    </main>
  );
}
