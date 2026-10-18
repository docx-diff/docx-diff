import { expect, test, type Page } from '@playwright/test';
import { bigPair } from '../test/big-pair';
import { readSamples, samplesAvailable } from '../test/samples';
import { downloadReviewed } from './download';
import { TWO_COLUMNS, pinView } from './viewSettings';

// Time budgets of the success metrics (docs/requirements.md): compare + display under 10 s (~60
// pages) and 60 s (~300 pages) once the engine has loaded, export under 10 s, and no frozen page.
// Opt-in with PERF=1: the sample pair is close to its budget (the engine takes ~8 s of it), so it
// would make the default run flaky on a busy machine.

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
// A main-thread task this long would make the page feel frozen.
const FROZEN_MS = 1000;

test.skip(!process.env.PERF, 'set PERF=1 to run the timing checks');

async function observeLongTasks(page: Page) {
  await page.goto('');
  await expect(page.getByRole('status')).toHaveText(/Engine ready/, { timeout: 60_000 });
  await page.evaluate(() => {
    const longTasks: number[] = [];
    (window as unknown as { longTasks: number[] }).longTasks = longTasks;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) longTasks.push(Math.round(entry.duration));
    }).observe({ type: 'longtask' });
  });
}

const longestTask = (page: Page) =>
  page.evaluate(() => Math.max(0, ...(window as unknown as { longTasks: number[] }).longTasks));

async function measure(page: Page, original: Uint8Array, edited: Uint8Array) {
  await observeLongTasks(page);
  const start = Date.now();
  await page.getByLabel('Original document').setInputFiles({ name: 'original.docx', mimeType: DOCX_TYPE, buffer: Buffer.from(original) });
  await page.getByLabel('Edited document').setInputFiles({ name: 'edited.docx', mimeType: DOCX_TYPE, buffer: Buffer.from(edited) });
  await expect(page.getByTestId('panel-left').locator('del.rev-del').first()).toBeVisible({ timeout: 120_000 });
  const compareMs = Date.now() - start;

  // Rejecting every undecided change is the slower export.
  const exportStart = Date.now();
  const file = await downloadReviewed(page, 'reject');
  const exportMs = Date.now() - exportStart;
  expect(file.bytes.byteLength).toBeGreaterThan(0);

  return { compareMs, exportMs, longestTaskMs: await longestTask(page) };
}

/**
 * Runs `action` in the page and returns the time until the frame after it: the decision, React's
 * render and the panels' layout effects (the Resolved column's update), then style and layout.
 */
function timeInPage(page: Page, action: 'accept' | 'reject' | 'confirm'): Promise<number> {
  return page.evaluate(async (action) => {
    const start = performance.now();
    if (action === 'confirm') document.querySelector<HTMLButtonElement>('[aria-modal="true"] .button--primary')!.click();
    else window.dispatchEvent(new KeyboardEvent('keydown', { key: action === 'accept' ? 'a' : 'r', bubbles: true }));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return Math.round(performance.now() - start);
  }, action);
}

/** The sample pair in three columns: first display, one decision, and Accept all or Reject all. */
async function measureThreeColumns(page: Page, bulk: 'Accept all' | 'Reject all') {
  const { original, edited } = readSamples();
  await observeLongTasks(page);
  const start = Date.now();
  await page.getByLabel('Original document').setInputFiles({ name: 'original.docx', mimeType: DOCX_TYPE, buffer: Buffer.from(original) });
  await page.getByLabel('Edited document').setInputFiles({ name: 'edited.docx', mimeType: DOCX_TYPE, buffer: Buffer.from(edited) });
  await expect(page.getByTestId('panel-left').locator('del.rev-del').first()).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId('panel-resolved').locator('ins.rev-ins').first()).toBeVisible();
  const compareMs = Date.now() - start;
  const totals = page.getByTestId('changes-totals');

  // The first change, rejected (its text changes in the Resolved column), then reset and accepted.
  await page.keyboard.press('j');
  const rejectMs = await timeInPage(page, 'reject');
  await expect(totals).toContainText('1 rejected');
  await page.keyboard.press('k');
  await page.keyboard.press('u');
  const acceptMs = await timeInPage(page, 'accept');
  await expect(totals).toContainText('1 accepted');

  await page.getByRole('button', { name: bulk }).click();
  await expect(page.getByRole('dialog', { name: `${bulk} changes?` })).toBeVisible();
  const bulkMs = await timeInPage(page, 'confirm');
  await expect(totals).toContainText(/ 0 undecided/);
  return { compareMs, rejectMs, acceptMs, bulkMs, longestTaskMs: await longestTask(page) };
}

test.describe('two columns', () => {
  // The view these tests were written for.
  test.beforeEach(({ page }) => pinView(page, TWO_COLUMNS));

  test('sample pair: compare and display under 10 s, export under 10 s', async ({ page }) => {
    test.skip(!samplesAvailable, 'sample documents not present');
    const { original, edited } = readSamples();
    const result = await measure(page, original, edited);
    console.log('sample pair:', result);
    expect(result.compareMs).toBeLessThan(10_000);
    expect(result.exportMs).toBeLessThan(10_000);
    expect(result.longestTaskMs).toBeLessThan(FROZEN_MS);
  });

  test('~300-page pair: compare and display under 60 s, export under 10 s', async ({ page }) => {
    test.setTimeout(240_000);
    const { original, edited } = bigPair();
    const result = await measure(page, original, edited);
    console.log('~300-page pair:', result);
    expect(result.compareMs).toBeLessThan(60_000);
    expect(result.exportMs).toBeLessThan(10_000);
    expect(result.longestTaskMs).toBeLessThan(FROZEN_MS);
  });
});

// The Resolved column: a decision under 100 ms, Accept all / Reject all under 1 s, the first display
// still under 10 s.
test.describe('three columns', () => {
  test.beforeEach(({ page }) => pinView(page, { threeColumns: true, changesList: true, outline: false }));

  for (const bulk of ['Reject all', 'Accept all'] as const) {
    test(`sample pair: one decision and ${bulk}`, async ({ page }) => {
      test.skip(!samplesAvailable, 'sample documents not present');
      const result = await measureThreeColumns(page, bulk);
      console.log(`sample pair, three columns, ${bulk}:`, result);
      expect(result.compareMs).toBeLessThan(10_000);
      expect(Math.max(result.rejectMs, result.acceptMs)).toBeLessThan(100);
      expect(result.bulkMs).toBeLessThan(1_000);
      expect(result.longestTaskMs).toBeLessThan(FROZEN_MS);
    });
  }
});
