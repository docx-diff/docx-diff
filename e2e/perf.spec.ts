import { expect, test, type Page } from '@playwright/test';
import { bigPair } from '../test/big-pair';
import { readSamples, samplesAvailable } from '../test/samples';
import { downloadReviewed } from './download';
import { TWO_COLUMNS, pinView } from './viewSettings';

// Time budgets of the success metrics (docs/requirements.md): compare + display under 10 s (~60
// pages) and 60 s (~300 pages) once the engine has loaded, export under 10 s, and no frozen page;
// an inline edit's update shown within 400 ms of the last keystroke.
// Opt-in with PERF=1: the sample pair is close to its budget (the engine takes ~8 s of it), so it
// would make the default run flaky on a busy machine.

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
// A main-thread task this long would make the page feel frozen.
const FROZEN_MS = 1000;

test.skip(!process.env.PERF, 'set PERF=1 to run the timing checks');
// Playwright's trace snapshots the page at each step, in the page's main thread.
test.use({ trace: 'off' });

async function observeLongTasks(page: Page) {
  await page.goto('');
  await expect(page.getByRole('status')).toHaveText(/Engine ready/, { timeout: 60_000 });
  await page.evaluate(() => {
    const longTasks: LongTask[] = [];
    (window as unknown as { longTasks: LongTask[] }).longTasks = longTasks;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) longTasks.push({ start: entry.startTime, duration: Math.round(entry.duration) });
    }).observe({ type: 'longtask' });
  });
}

interface LongTask {
  start: number;
  duration: number;
}

/** The longest main-thread task so far, or of those that started in `[from, to)` (page time). */
const longestTask = (page: Page, from = 0, to = Infinity) =>
  page.evaluate(
    ({ from, to }) =>
      Math.max(
        0,
        ...(window as unknown as { longTasks: LongTask[] }).longTasks
          .filter((task) => task.start >= from && task.start < to)
          .map((task) => task.duration),
      ),
    { from, to },
  );

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

// A word typed into the Edited panel (three columns, the most panels to update): on the sample,
// shown as a change within 400 ms of the last keystroke (the 300 ms delay included), no task over
// 50 ms while typing, the update's task under 100 ms. On the ~300-page pair the browser's own paint
// and layout of the long panels takes 35–60 ms per frame (a keystroke's too) before any of our code,
// so there an update gets 300 ms after the delay: 180–245 ms measured, a decision 115–125 ms
// (docs/measurements.md, "Inline edits").
const TYPED = 'xyzzy';
const KEY_DELAY_MS = 80;
/** `UPDATE_DELAY_MS` of `src/ui/editing.ts`. */
const UPDATE_DELAY_MS = 300;

/** One decision timed, then ` xyzzy` typed at the end of an editable paragraph and its update timed. */
async function measureEdit(page: Page, original: Uint8Array, edited: Uint8Array) {
  await observeLongTasks(page);
  await page.getByLabel('Original document').setInputFiles({ name: 'original.docx', mimeType: DOCX_TYPE, buffer: Buffer.from(original) });
  await page.getByLabel('Edited document').setInputFiles({ name: 'edited.docx', mimeType: DOCX_TYPE, buffer: Buffer.from(edited) });
  await expect(page.getByTestId('panel-left').locator('del.rev-del').first()).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId('panel-resolved').locator('ins.rev-ins').first()).toBeVisible();
  await page.keyboard.press('j');
  const decisionMs = await timeInPage(page, 'accept');

  const toggle = page.getByRole('button', { name: 'Editable' });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  const block = page
    .getByTestId('panel-right')
    .locator('p[contenteditable="true"]')
    .filter({ hasText: /\S{4}.{40}/ })
    .nth(5);
  await block.click();
  await page.keyboard.press('Control+End');

  await page.getByTestId('panel-right').evaluate((host, typed) => {
    const timing = { firstKey: 0, lastKey: 0, frame: 0 };
    (window as unknown as { editTiming: typeof timing }).editTiming = timing;
    window.addEventListener(
      'keydown',
      () => {
        timing.lastKey = performance.now();
        timing.firstKey ||= timing.lastKey;
      },
      true,
    );
    // The update gives the typed word an element of its own change; the browser's typing doesn't.
    const changed = (node: Node) =>
      node instanceof Element && [node, ...node.querySelectorAll('[data-change-id]')].some((element) => element.matches('[data-change-id]') && element.textContent!.includes(typed));
    const observer = new MutationObserver((records) => {
      if (!records.some((record) => [...record.addedNodes].some(changed))) return;
      observer.disconnect();
      requestAnimationFrame(() => requestAnimationFrame(() => (timing.frame = performance.now())));
    });
    observer.observe(host.shadowRoot!, { childList: true, subtree: true });
  }, TYPED);
  await page.keyboard.type(` ${TYPED}`, { delay: KEY_DELAY_MS });

  const timing = () => page.evaluate(() => (window as unknown as { editTiming: { firstKey: number; lastKey: number; frame: number } }).editTiming);
  await expect.poll(async () => (await timing()).frame, { timeout: 10_000 }).toBeGreaterThan(0);
  const { firstKey, lastKey, frame } = await timing();
  return {
    decisionMs,
    // From the last keystroke to the frame after the update.
    shownMs: Math.round(frame - lastKey),
    // From the end of the delay to that frame.
    updateMs: Math.round(frame - lastKey - UPDATE_DELAY_MS),
    longestKeystrokeTaskMs: await longestTask(page, firstKey, lastKey + KEY_DELAY_MS),
    longestUpdateTaskMs: await longestTask(page, lastKey + UPDATE_DELAY_MS - 50),
  };
}

test.describe('inline edit, three columns', () => {
  test.beforeEach(({ page }) => pinView(page, { threeColumns: true, changesList: true, outline: false }));

  test('sample pair: a typed word is shown within 400 ms, no task over 50 ms while typing', async ({ page }) => {
    test.skip(!samplesAvailable, 'sample documents not present');
    const { original, edited } = readSamples();
    const result = await measureEdit(page, original, edited);
    console.log('sample pair, inline edit:', result);
    expect(result.shownMs).toBeLessThan(400);
    expect(result.longestKeystrokeTaskMs).toBeLessThan(50);
    expect(result.longestUpdateTaskMs).toBeLessThan(100);
  });

  test('~300-page pair: an update within 300 ms after the delay, no task over 100 ms while typing', async ({ page }) => {
    test.setTimeout(240_000);
    const { original, edited } = bigPair();
    const result = await measureEdit(page, original, edited);
    console.log('~300-page pair, inline edit:', result);
    expect(result.longestKeystrokeTaskMs).toBeLessThan(100);
    expect(result.updateMs).toBeLessThan(300);
  });
});
