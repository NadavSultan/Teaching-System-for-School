import { describe, expect, it } from 'vitest';
import {
  assessmentCreationSchema,
  assessmentRevisionSchema,
  curriculumImportSchema,
} from './index.js';

const id = '00000000-0000-4000-8000-000000000001';

describe('Phase 20 contracts', () => {
  it('does not accept client supplied organization authority', () => {
    expect(
      assessmentCreationSchema.safeParse({ version: '1.0.0', type: 'WORKSHEET', title: 'דף' })
        .success,
    ).toBe(true);
    expect(
      assessmentCreationSchema.safeParse({
        version: '1.0.0',
        organizationId: id,
        type: 'WORKSHEET',
        title: 'דף',
      }).success,
    ).toBe(false);
  });
  it('bounds curriculum and revision structures', () => {
    expect(
      curriculumImportSchema.safeParse({
        version: '1.0.0',
        code: 'HEBREW',
        educationSystemCode: 'IL',
        subjectCode: 'HE',
        displayName: 'עברית',
        versionNumber: 1,
        nodes: [],
      }).success,
    ).toBe(false);
    expect(
      assessmentRevisionSchema.safeParse({
        version: '1.0.0',
        assessmentId: id,
        idempotencyKey: 'key',
        curriculumVersionId: id,
        scoringMode: 'POINTS',
        totalScoreUnits: 10000,
        curriculumNodeIds: [],
        sections: [],
      }).success,
    ).toBe(false);
  });
});
