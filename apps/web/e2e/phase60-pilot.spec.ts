import { expect, test } from '@playwright/test';

test('Grade 8 pilot journey has no client failures or horizontal clipping', async ({ page }) => {
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));
  page.on('requestfailed', (request) => failedRequests.push(request.url()));

  await page.goto('/assessments');
  await page.getByRole('link', { name: 'יצירת הערכה חדשה' }).click();
  await page.getByRole('link', { name: 'המשך לעורך' }).click();
  await page.getByLabel('שאלה 1').fill('נסחו תשובה מלאה.');
  await page.getByRole('button', { name: 'שמירת גרסה' }).click();
  await expect(page.getByText('הגרסה נשמרה')).toBeVisible();
  await page.getByLabel('סיבת אישור אזהרה').fill('נבדק מול חומר המקור הזכאי.');
  await page.getByRole('button', { name: 'אישור אזהרה' }).click();
  await page.getByLabel('אישור גרסה בלתי־ניתנת לשינוי: גרסה 2').check();
  await page.getByRole('button', { name: 'אישור גרסה 2' }).click();
  await expect(page.getByRole('heading', { name: /נעולה לאישור/ })).toBeVisible();
  await page.getByRole('button', { name: 'טעינה מחדש של מצב שמור' }).click();
  await expect(page.getByText('המצב השמור נטען מחדש.')).toBeVisible();
  expect(
    await page.locator('body').evaluate((element) => element.scrollWidth <= window.innerWidth),
  ).toBe(true);
  expect(consoleErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
});
