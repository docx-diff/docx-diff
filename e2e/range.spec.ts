import { expect, test, type Page } from '@playwright/test';
import { minimalDocx } from '../test/minimal-docx';
import { readSamples, samplesAvailable } from '../test/samples';
import { docxText } from '../test/text';
import { downloadReviewed } from './download';

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

async function openAndCompare(page: Page, original: Uint8Array, edited: Uint8Array) {
  await page.goto('');
  await expect(page.getByRole('status')).toHaveText(/Engine ready/, { timeout: 60_000 });
  await page.getByLabel('Original document').setInputFiles({ name: 'original.docx', mimeType: DOCX_TYPE, buffer: Buffer.from(original) });
  await page.getByLabel('Edited document').setInputFiles({ name: 'edited.docx', mimeType: DOCX_TYPE, buffer: Buffer.from(edited) });
  await expect(page.getByTestId('range-control')).toBeVisible({ timeout: 60_000 });
}

async function download(page: Page, undecided: 'accept' | 'reject' = 'accept'): Promise<Uint8Array> {
  return (await downloadReviewed(page, undecided)).bytes;
}

/** "N text changes: …" from the list footer. */
async function textChangeCount(page: Page): Promise<number> {
  const totals = (await page.getByTestId('changes-totals').textContent()) ?? '';
  return Number(/(\d+) text changes/.exec(totals)![1]);
}

const body = (bytes: Uint8Array) => docxText(bytes, ['word/document.xml']);

test('a document cut short: the detected range, its export, and turning it off', async ({ page }) => {
  // The Edited document stops after the second paragraph and changes a word in the first.
  const original = minimalDocx(['One two three.', 'Four five six.', 'Seven eight nine.', 'Ten eleven twelve.']);
  const edited = minimalDocx(['One 2 three.', 'Four five six.']);
  await openAndCompare(page, original, edited);

  const control = page.getByTestId('range-control');
  await expect(control).toContainText('The edited document appears to end at paragraph 2 of the Original. The remaining 2 paragraphs are treated as unedited');
  await expect(page.getByTestId('change-card')).toHaveCount(1);
  const left = page.getByTestId('panel-left');
  await expect(left.locator('.range-divider')).toBeVisible();
  await expect(left.locator('p.out-of-range')).toHaveCount(2);
  await expect(left.locator('del.change-out-of-range', { hasText: 'Seven' })).toBeVisible();
  // The overview bar shades the part outside the range.
  await expect(page.getByTestId('overview-left').locator('.overview-bar__outside')).toHaveCount(1);

  // Undecided changes are accepted; the part outside the range keeps the Original's text.
  expect(body(await download(page))).toEqual(['One 2 three.', 'Four five six.', 'Seven eight nine.', 'Ten eleven twelve.']);

  await control.getByRole('button', { name: 'Compare the full documents' }).click();
  await expect(control).toContainText('Comparing the full documents.');
  await expect(page.getByTestId('change-card')).toHaveCount(2);
  await expect(left.locator('.range-divider')).toHaveCount(0);
  await expect(left.locator('.out-of-range')).toHaveCount(0);
  expect(body(await download(page))).toEqual(['One 2 three.', 'Four five six.']);

  // By number: up to paragraph 1 leaves the change in the first paragraph inside.
  await control.getByRole('button', { name: /Set an end point/ }).click();
  await control.getByLabel(/Compare the Original up to paragraph/).fill('1');
  await control.getByRole('button', { name: 'Apply' }).click();
  await expect(control).toContainText('Comparing the Original up to paragraph 1. The remaining 3 paragraphs');
  await expect(page.getByTestId('change-card')).toHaveCount(1);
  await expect(left.locator('p.out-of-range')).toHaveCount(3);

  // By picking a paragraph in the left panel; Esc cancels picking.
  await control.getByRole('button', { name: /Change the end point/ }).click();
  await control.getByRole('button', { name: 'Pick in left panel' }).click();
  await expect(control).toContainText('Click the last paragraph to compare');
  await page.keyboard.press('Escape');
  await expect(control).toContainText('Comparing the Original up to paragraph 1.');
  await control.getByRole('button', { name: /Change the end point/ }).click();
  await control.getByRole('button', { name: 'Pick in left panel' }).click();
  await left.getByText('Seven').click();
  await expect(control).toContainText('Comparing the Original up to paragraph 3. The remaining 1 paragraph is');
  await expect(left.locator('p.out-of-range')).toHaveCount(1);
  // The deletion of paragraphs 3 and 4 now spans the end point.
  await expect(page.getByTestId('range-spanning')).toContainText('A deletion starts before the end point');

  await control.getByRole('button', { name: /Use the detected end point/ }).click();
  await expect(control).toContainText('appears to end at paragraph 2');
});

test('picking the last paragraph compares the full documents', async ({ page }) => {
  const original = minimalDocx(['One two three.', 'Four five six.', 'Seven eight nine.']);
  const edited = minimalDocx(['One 2 three.']);
  await openAndCompare(page, original, edited);
  const control = page.getByTestId('range-control');
  await control.getByRole('button', { name: /Change the end point/ }).click();
  await control.getByRole('button', { name: 'Pick in left panel' }).click();
  await page.getByTestId('panel-left').getByText('Seven').click();
  await expect(control).toContainText('Comparing the full documents.');
});

test('on the sample pair, the tail is outside the range and the export is the Edited text followed by the Original tail', async ({ page }) => {
  test.skip(!samplesAvailable, 'sample documents not present');
  const { original, edited } = readSamples();
  await openAndCompare(page, original, edited);

  const control = page.getByTestId('range-control');
  await expect(control).toContainText('The edited document appears to end at paragraph 168 of the Original. The remaining 579 paragraphs are treated as unedited');
  const left = page.getByTestId('panel-left');
  await expect(left.locator('.range-divider')).toHaveCount(1);
  expect(await left.locator('p.out-of-range').count()).toBeGreaterThan(500);
  const inRange = await textChangeCount(page);

  const exported = body(await download(page));
  const [originalBody, editedBody] = [body(original), body(edited)];
  const tailStart = originalBody.indexOf('KORAI KELÉS');
  expect(tailStart).toBeGreaterThan(0);
  // The Edited document's closing "reviewed up to here" note, which the engine placed after the
  // deleted tail, is in range: the export keeps it, before the Original tail.
  expect(exported).toEqual([...editedBody, ...originalBody.slice(tailStart)]);

  const summary = page.getByTestId('changes-totals');
  await expect(summary).toHaveText(/· 54 ignored/);

  // Without the range, the tail deletion is listed too.
  await control.getByRole('button', { name: 'Compare the full documents' }).click();
  await expect.poll(() => textChangeCount(page)).toBe(inRange + 1);
  await expect(summary).toHaveText(/· 54 ignored/);
  await expect(left.locator('.range-divider')).toHaveCount(0);
  expect(body(await download(page))).toEqual(editedBody);
});
