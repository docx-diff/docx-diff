import { expect, test, type Page } from '@playwright/test';
import { bigPair } from '../test/big-pair';
import { readSamples, samplesAvailable } from '../test/samples';
import { downloadReviewed } from './download';

// Time budgets of the PRD success metrics: compare + display under 10 s (~60 pages) and 60 s
// (~300 pages) once the engine has loaded, export under 10 s, and no frozen page. Opt-in with PERF=1:
// the sample pair is close to its budget (the engine takes ~8 s of it), so it would make the default
// run flaky on a busy machine.

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
// A main-thread task this long would make the page feel frozen.
const FROZEN_MS = 1000;

test.skip(!process.env.PERF, 'set PERF=1 to run the timing checks');

async function measure(page: Page, original: Uint8Array, edited: Uint8Array) {
  await page.goto('');
  await expect(page.getByRole('status')).toHaveText(/Engine ready/, { timeout: 60_000 });
  await page.evaluate(() => {
    const longTasks: number[] = [];
    (window as unknown as { longTasks: number[] }).longTasks = longTasks;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) longTasks.push(Math.round(entry.duration));
    }).observe({ type: 'longtask' });
  });

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

  const longTasks = await page.evaluate(() => (window as unknown as { longTasks: number[] }).longTasks);
  return { compareMs, exportMs, longestTaskMs: Math.max(0, ...longTasks) };
}

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
