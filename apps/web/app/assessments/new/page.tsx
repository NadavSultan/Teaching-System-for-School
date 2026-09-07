'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { teacherApi } from '../../teacher-api';

export default function NewAssessmentPage() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [type, setType] = useState<'WORKSHEET' | 'TEST'>('WORKSHEET');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  async function create() {
    setSaving(true);
    setError('');
    try {
      const assessment = await teacherApi.create({ version: '1.0.0', type, title });
      router.push(`/assessments/${assessment.id}`);
    } catch {
      setError('יצירת ההערכה נכשלה.');
    } finally {
      setSaving(false);
    }
  }
  return (
    <main id="main" className="workspace-shell">
      <h1>יצירת הערכה</h1>
      <p>
        שם וסוג ההערכה נשמרים דרך ממשק המורה. יצירת גרסה ראשונה דורשת תכנית לימודים ומקור זכאי
        מהשירות המורשה.
      </p>
      <label htmlFor="assessment-title">כותרת</label>
      <input
        id="assessment-title"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />
      <label htmlFor="assessment-type">סוג</label>
      <select
        id="assessment-type"
        value={type}
        onChange={(event) => setType(event.target.value as 'WORKSHEET' | 'TEST')}
      >
        <option value="WORKSHEET">דף עבודה</option>
        <option value="TEST">מבחן</option>
      </select>
      {error && <p role="alert">{error}</p>}
      <button type="button" disabled={!title.trim() || saving} onClick={() => void create()}>
        יצירת הערכה שמורה
      </button>
    </main>
  );
}
