import { expect, test, type Page } from '@playwright/test';
import { minimalDocx } from '../test/minimal-docx';
import { readSamples, samplesAvailable } from '../test/samples';
import { docxText } from '../test/text';
import { downloadReviewed } from './download';
import { TWO_COLUMNS, pinView } from './viewSettings';
import { compareFull } from './rangeDialog';

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

async function openApp(page: Page) {
  await page.goto('');
  await expect(page.getByRole('status')).toHaveText(/Engine ready/, { timeout: 60_000 });
}

async function chooseFiles(page: Page, original: { name: string; bytes: Uint8Array }, edited: { name: string; bytes: Uint8Array }) {
  await page.getByLabel('Original document').setInputFiles({ name: original.name, mimeType: DOCX_TYPE, buffer: Buffer.from(original.bytes) });
  await page.getByLabel('Edited document').setInputFiles({ name: edited.name, mimeType: DOCX_TYPE, buffer: Buffer.from(edited.bytes) });
}

const download = downloadReviewed;

// The view these tests were written for (the three-column view has its own tests in resolved.spec.ts).
test.beforeEach(({ page }) => pinView(page, TWO_COLUMNS));

test('rejects a file that is not a .docx', async ({ page }) => {
  await openApp(page);
  await page.getByLabel('Original document').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await expect(page.getByRole('alert')).toHaveText(/“notes\.txt” is not a Word document/);
  await page.getByLabel('Original document').setInputFiles({ name: 'fake.docx', mimeType: DOCX_TYPE, buffer: Buffer.from('not a zip') });
  await expect(page.getByRole('alert')).toHaveText(/“fake\.docx” is damaged/);
});

test('compares two small documents, shows each side, swaps, and downloads the Edited text', async ({ page }) => {
  await openApp(page);
  const original = { name: 'original.docx', bytes: minimalDocx(['The quick brown fox.', 'Second paragraph.']) };
  const edited = { name: 'edited.docx', bytes: minimalDocx(['The quick red fox.', 'Second paragraph.', 'A new ending.']) };
  await chooseFiles(page, original, edited);

  const left = page.getByTestId('panel-left');
  const right = page.getByTestId('panel-right');
  await expect(left.locator('del.rev-del').first()).toBeVisible({ timeout: 60_000 });
  await expect(left.locator('del.rev-del', { hasText: 'brown' })).toBeVisible();
  await expect(left.locator('ins', { hasText: 'red' })).toBeHidden();
  await expect(left.getByText('A new ending.')).toBeHidden();
  await expect(right.locator('ins.rev-ins', { hasText: 'red' })).toBeVisible();
  await expect(right.locator('del', { hasText: 'brown' })).toBeHidden();
  await expect(right.getByText('A new ending.')).toBeVisible();
  // Every highlighted element is linked to its change item.
  expect(await left.locator('del.rev-del:not([data-change-id])').count()).toBe(0);

  await expect(page.getByRole('heading', { name: 'original.docx' })).toBeVisible();
  const file = await download(page);
  expect(file.name).toBe('edited.reviewed.docx');
  expect(docxText(file.bytes)).toEqual(docxText(edited.bytes));

  await page.getByRole('button', { name: /Swap/ }).click();
  await expect(page.getByRole('heading', { name: 'edited.docx' }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('panel-left').locator('del.rev-del', { hasText: 'red' })).toBeVisible({ timeout: 60_000 });
});

test('compares the sample pair, keeps the panels in sync and, without the range, downloads the Edited text', async ({ page }) => {
  test.skip(!samplesAvailable, 'sample documents not present');
  await openApp(page);
  // Long tasks on the main thread while comparing (the work runs in the worker).
  await page.evaluate(() => {
    (window as unknown as { longTasks: number[] }).longTasks = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) (window as unknown as { longTasks: number[] }).longTasks.push(Math.round(entry.duration));
    }).observe({ type: 'longtask' });
  });

  const { original, edited } = readSamples();
  const start = Date.now();
  await chooseFiles(page, { name: 'original.docx', bytes: original }, { name: 'edited.docx', bytes: edited });
  const left = page.getByTestId('panel-left');
  const right = page.getByTestId('panel-right');
  await expect(left.locator('del.rev-del').first()).toBeVisible({ timeout: 60_000 });
  const elapsed = Date.now() - start;
  const longTasks = await page.evaluate(() => (window as unknown as { longTasks: number[] }).longTasks);
  console.log(`sample pair: files chosen → panels shown in ${elapsed} ms; main-thread long tasks (ms):`, longTasks);

  expect(await left.locator('del.rev-del').count()).toBeGreaterThan(1000);
  expect(await right.locator('ins.rev-ins').count()).toBeGreaterThan(100);
  // The deleted tail (579 paragraphs) is hidden on the right.
  expect(await right.locator('.not-in-edited').count()).toBeGreaterThan(579);

  // Scrolling the left panel moves the right one; with Scroll lock off it stays put.
  await left.evaluate((element) => {
    element.scrollTop = 3000;
  });
  await expect.poll(() => right.evaluate((element) => element.scrollTop)).toBeGreaterThan(1000);
  await page.getByRole('button', { name: /Scroll lock/ }).click();
  const rightTop = await right.evaluate((element) => element.scrollTop);
  await left.evaluate((element) => {
    element.scrollTop = 6000;
  });
  await page.waitForTimeout(300);
  expect(await right.evaluate((element) => element.scrollTop)).toBe(rightTop);

  // With the detected range (the default), the download is the Edited text followed by the
  // Original's unedited tail (e2e/range.spec.ts); without it, the Edited text.
  await compareFull(page);
  const file = await download(page);
  expect(file.name).toBe('edited.reviewed.docx');
  expect(docxText(file.bytes)).toEqual(docxText(edited));

  // Compare settings: quote changes are ignored by default; turning that off shows them again.
  const summary = page.getByTestId('changes-totals');
  await expect(summary).toHaveText(/· 54 ignored/);
  // The deleted „szentelt" is four elements: „ / szent / elt / ".
  const szentelt = left.locator('del', { hasText: /^szent$/ });
  await expect(szentelt).toHaveClass(/change-ignored/);
  // In "szövegek "az" → "szutták szövegei “az" only the changed words are highlighted.
  const quotedAz = left.locator('del', { hasText: /^"az$/ }).first();
  await expect(quotedAz).toHaveClass(/change-common/);
  await page.getByRole('button', { name: /Compare settings/ }).click();
  await page.getByLabel(/Ignore quote style/).uncheck();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  // 10 of the 54 need quote (and ellipsis) folding; the others differ in dashes or whitespace only.
  await expect(summary).toHaveText(/· 44 ignored/);
  await expect(szentelt).not.toHaveClass(/change-ignored/);
  await expect(quotedAz).not.toHaveClass(/change-common/);
});

test('hides the blank paragraphs by default, which keeps the synced panels closer together (FR-20b)', async ({ page }) => {
  test.skip(!samplesAvailable, 'sample documents not present');
  await openApp(page);
  const { original, edited } = readSamples();
  await chooseFiles(page, { name: 'original.docx', bytes: original }, { name: 'edited.docx', bytes: edited });
  const left = page.getByTestId('panel-left');
  await expect(left.locator('del.rev-del').first()).toBeVisible({ timeout: 60_000 });
  const blankShown = () => left.evaluate((element) => [...element.shadowRoot!.querySelectorAll('[data-blank]')].filter((block) => block.getClientRects().length > 0).length);

  // How far apart the blocks both panels show are in their viewports, on average, at a few scroll
  // positions of the Original's panel (the sync aligns the top one).
  const drift = () =>
    page.evaluate(async () => {
      const [left, right] = ['panel-left', 'panel-right'].map((id) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!);
      const offsets = (scroller: HTMLElement) => {
        const top = scroller.getBoundingClientRect().top;
        const shown = new Map<string, number>();
        for (const block of scroller.shadowRoot!.querySelectorAll<HTMLElement>('[data-anchor]')) {
          const rect = block.getBoundingClientRect();
          if (rect.height > 0 && rect.top >= top && rect.bottom <= top + scroller.clientHeight) shown.set(block.dataset.anchor!, rect.top - top);
        }
        return shown;
      };
      const gaps: number[] = [];
      for (let i = 1; i <= 8; i++) {
        left!.scrollTop = (i / 10) * (left!.scrollHeight / 3);
        await new Promise((resolve) => setTimeout(resolve, 150));
        const rightOffsets = offsets(right!);
        for (const [anchor, offset] of offsets(left!)) {
          const other = rightOffsets.get(anchor);
          if (other !== undefined) gaps.push(Math.abs(offset - other));
        }
      }
      return Math.round(gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length);
    });

  expect(await blankShown()).toBe(0);
  const hidden = await drift();
  await page.getByRole('button', { name: /Compare settings/ }).click();
  await page.getByLabel(/Hide empty paragraphs/).uncheck();
  await page.keyboard.press('Escape');
  await expect.poll(blankShown).toBeGreaterThan(300);
  const shown = await drift();
  console.log(`sample pair: blocks both panels show are ${hidden} px apart on average with blank paragraphs hidden, ${shown} px with them shown`);
  expect(hidden).toBeLessThan(shown);
});
