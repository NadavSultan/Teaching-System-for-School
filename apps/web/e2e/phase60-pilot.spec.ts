import { expect, test } from '@playwright/test';

const assessmentId = '11111111-1111-4111-8111-111111111111';
const revisionId = '22222222-2222-4222-8222-222222222222';
const questionId = '33333333-3333-4333-8333-333333333333';
const logicalId = '44444444-4444-4444-8444-444444444444';
const item = {
  version: '1.0.0',
  id: assessmentId,
  type: 'WORKSHEET',
  title: 'דף עבודה לכיתה ז׳',
  latestRevisionNumber: 1,
  latestRevisionId: revisionId,
  latestApprovalRevisionId: null,
  updatedAt: '2026-09-07T00:00:00.000Z',
};
const workspace = {
  version: '1.0.0',
  assessment: item,
  revision: {
    version: '1.0.0',
    id: revisionId,
    assessmentId,
    revisionNumber: 1,
    baseRevisionId: null,
    curriculumVersionId: '55555555-5555-4555-8555-555555555555',
    scoringMode: 'NONE',
    totalScoreUnits: null,
    finalized: true,
    curriculumNodeIds: ['66666666-6666-4666-8666-666666666666'],
    sections: [
      {
        id: '77777777-7777-4777-8777-777777777777',
        key: 'section-1',
        title: 'תחביר',
        instructions: null,
        order: 0,
        scoreUnits: null,
        questions: [
          {
            id: questionId,
            logicalId,
            key: 'question-1',
            type: 'OPEN',
            prompt: 'נסחו תשובה מלאה.',
            instructions: null,
            order: 0,
            scoreUnits: null,
            answers: [
              {
                id: '88888888-8888-4888-8888-888888888888',
                key: 'answer-1',
                order: 0,
                text: 'תשובת מורה',
                explanation: null,
              },
            ],
            rubrics: [],
            subQuestions: [],
          },
        ],
      },
    ],
  },
  history: [
    {
      id: revisionId,
      assessmentId,
      revisionNumber: 1,
      baseRevisionId: null,
      createdAt: '2026-09-07T00:00:00.000Z',
      approvedAt: null,
      isLatest: true,
    },
  ],
  validation: null,
  readiness: {
    version: '1.0.0',
    status: 'BLOCKED',
    reasonCode: 'VALIDATION_REQUIRED',
    validationRunId: null,
  },
  approval: {
    version: '1.0.0',
    assessmentRevisionId: revisionId,
    approved: false,
    approvalId: null,
    approvalSequence: null,
  },
};

test('persisted teacher workspace reloads and student preview stays redacted', async ({ page }) => {
  const requested: string[] = [];
  await page.route('**/v1/teacher/**', async (route) => {
    const url = route.request().url();
    requested.push(url);
    if (url.endsWith('/assessments'))
      return route.fulfill({ json: { version: '1.0.0', items: [item], nextCursor: null } });
    if (url.includes('/student-preview'))
      return route.fulfill({
        json: {
          version: '1.0.0',
          assessmentId,
          revisionId,
          title: item.title,
          sections: [
            {
              title: 'תחביר',
              order: 0,
              questions: [
                {
                  logicalId,
                  prompt: 'נסחו תשובה מלאה.',
                  instructions: null,
                  order: 0,
                  scoreUnits: null,
                },
              ],
            },
          ],
        },
      });
    return route.fulfill({ json: workspace });
  });
  await page.goto('/assessments');
  await page.getByRole('link', { name: /דף עבודה לכיתה ז׳/ }).click();
  await expect(page.getByRole('heading', { name: /סביבת מורה/ })).toBeVisible();
  await page.getByRole('button', { name: 'טעינה מחדש של מצב שמור' }).click();
  await expect(page.getByText('המצב השמור נטען מחדש מהשרת.')).toBeVisible();
  await page.getByRole('link', { name: 'פתיחת תצוגה בטוחה לתלמיד' }).click();
  await expect(page.getByText('נסחו תשובה מלאה.')).toBeVisible();
  await expect(page.getByText('תשובת מורה')).toHaveCount(0);
  expect(
    requested.filter((url) => url.includes(`/assessments/${assessmentId}`)).length,
  ).toBeGreaterThanOrEqual(3);
  expect(
    await page.locator('body').evaluate((element) => element.scrollWidth <= window.innerWidth),
  ).toBe(true);
});
