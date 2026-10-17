import { expect, test, type Page } from '@playwright/test';
import { minimalDocx } from '../test/minimal-docx';

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// The Edited document stops after the third paragraph and changes a word in each of the three.
const ORIGINAL = minimalDocx(['One two three.', 'Four five six.', 'Seven eight nine.', 'Ten eleven twelve.', 'Thirteen.']);
const EDITED = minimalDocx(['One 2 three.', 'Four 5 six.', 'Seven 8 nine.']);

async function openAndCompare(page: Page) {
  await page.goto('');
  await expect(page.getByRole('status')).toHaveText(/Engine ready/, { timeout: 60_000 });
  await page.getByLabel('Original document').setInputFiles({ name: 'original.docx', mimeType: DOCX_TYPE, buffer: Buffer.from(ORIGINAL) });
  await page.getByLabel('Edited document').setInputFiles({ name: 'edited.docx', mimeType: DOCX_TYPE, buffer: Buffer.from(EDITED) });
  await expect(page.getByTestId('change-card').first()).toBeVisible({ timeout: 60_000 });
}

/** The saved review record in the page's IndexedDB, after merging `patch` into it. */
function savedReview(page: Page, patch?: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  return page.evaluate(
    (patch) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('docx-diff');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const store = db.transaction('reviews', 'readwrite').objectStore('reviews');
          const get = store.get('current-review');
          get.onsuccess = () => {
            const record = get.result ?? null;
            if (record && patch) store.put(Object.assign(record, patch), 'current-review');
            store.transaction.oncomplete = () => {
              db.close();
              resolve(record);
            };
          };
        };
      }),
    patch,
  );
}

async function reviewSomeChanges(page: Page) {
  const control = page.getByTestId('range-control');
  await expect(control).toContainText('appears to end at paragraph 3');
  await control.getByRole('button', { name: /Change the end point/ }).click();
  await control.getByLabel(/Compare the Original up to paragraph/).fill('2');
  await control.getByRole('button', { name: 'Apply' }).click();
  const cards = page.getByTestId('change-card');
  await expect(cards).toHaveCount(2);
  await cards.nth(0).getByRole('button', { name: 'Reject', exact: true }).click();
  await cards.nth(1).getByRole('button', { name: 'Accept', exact: true }).click();
  // Wait for the debounced save.
  await expect
    .poll(async () => Object.keys(((await savedReview(page))?.decisions as object | undefined) ?? {}).length)
    .toBe(2);
}

const prompt = (page: Page) => page.getByRole('dialog', { name: 'Resume review of original.docx → edited.docx?' });

test('a review is saved and resumed after a reload with the same decisions and range', async ({ page }) => {
  await openAndCompare(page);
  await reviewSomeChanges(page);

  await page.reload();
  await expect(prompt(page)).toBeVisible({ timeout: 60_000 });
  await prompt(page).getByRole('button', { name: 'Resume' }).click();
  const cards = page.getByTestId('change-card');
  await expect(cards).toHaveCount(2, { timeout: 60_000 });
  await expect(cards.nth(0)).toContainText('Rejected');
  await expect(cards.nth(1)).toContainText('Accepted');
  await expect(page.getByTestId('range-control')).toContainText('Comparing the Original up to paragraph 2.');
  await expect(page.getByTestId('changes-totals')).toContainText('2 text changes: 1 accepted, 1 rejected, 0 undecided');
  await expect(page.getByTestId('panel-left').locator('del.change-rejected')).toHaveCount(1);

  // Start new keeps the saved review for the next visit; Discard deletes it.
  await page.reload();
  await prompt(page).getByRole('button', { name: 'Start new' }).click();
  await expect(prompt(page)).toBeHidden();
  await expect(page.getByLabel('Original document')).toBeAttached();
  await page.reload();
  await prompt(page).getByRole('button', { name: 'Discard' }).click();
  await expect(prompt(page)).toBeHidden();
  await page.reload();
  await expect(page.getByRole('status')).toHaveText(/Engine ready/, { timeout: 60_000 });
  await expect(prompt(page)).toHaveCount(0);
});

test('Close review deletes the saved review and goes back to choosing files', async ({ page }) => {
  await openAndCompare(page);
  await reviewSomeChanges(page);
  await page.getByRole('toolbar').getByRole('button', { name: /Close review/ }).click();
  const confirm = page.getByRole('dialog', { name: 'Close this review?' });
  await confirm.getByRole('button', { name: 'Close review' }).click();
  await expect(page.getByLabel('Original document')).toBeAttached();
  await expect(page.getByTestId('change-card')).toHaveCount(0);
  await expect.poll(() => savedReview(page)).toBeNull();

  await page.reload();
  await expect(page.getByRole('status')).toHaveText(/Engine ready/, { timeout: 60_000 });
  await expect(prompt(page)).toHaveCount(0);
});

test('decisions saved with another engine version are not restored', async ({ page }) => {
  await openAndCompare(page);
  await reviewSomeChanges(page);
  await savedReview(page, { engineVersion: '12.0.0' });

  await page.reload();
  await prompt(page).getByRole('button', { name: 'Resume' }).click();
  await expect(page.getByText(/made with version 12\.0\.0 of the comparison engine/)).toBeVisible({ timeout: 60_000 });
  // Compared again from the saved files, with the detected range and no decisions.
  await expect(page.getByTestId('range-control')).toContainText('appears to end at paragraph 3');
  await expect(page.getByTestId('changes-totals')).toContainText('3 text changes: 0 accepted, 0 rejected, 3 undecided');
});

test('without browser storage the app works and says the review will not be remembered', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', {
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    });
  });
  await openAndCompare(page);
  await expect(page.getByTestId('storage-unavailable')).toContainText('will not be remembered');
  await page.getByTestId('storage-unavailable').getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.getByTestId('storage-unavailable')).toHaveCount(0);
  await expect(page.getByTestId('change-card')).toHaveCount(3);
});
