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
  await expect(page.getByTestId('change-card').first()).toBeVisible({ timeout: 60_000 });
}

async function download(page: Page, undecided: 'accept' | 'reject' = 'accept'): Promise<Uint8Array> {
  return (await downloadReviewed(page, undecided)).bytes;
}

async function acceptAllUndecided(page: Page) {
  await page.getByRole('button', { name: 'Accept all' }).click();
  const dialog = page.getByRole('dialog', { name: 'Accept all changes?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Accept all' }).click();
  await expect(dialog).toBeHidden();
}

test('rejecting the first change and accepting the rest keeps the Original text of that change only', async ({ page }) => {
  const original = minimalDocx(['The quick brown fox.', 'Second paragraph.']);
  const edited = minimalDocx(['The quick red fox.', 'Second paragraph.', 'A new ending.']);
  await openAndCompare(page, original, edited);

  const cards = page.getByTestId('change-card');
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toContainText('Replaced');
  await cards.nth(0).getByRole('button', { name: 'Reject' }).click();
  await expect(cards.nth(0)).toContainText('Rejected');
  await expect(page.getByTestId('changes-totals')).toContainText('2 text changes: 0 accepted, 1 rejected, 1 undecided');

  await acceptAllUndecided(page);
  await expect(page.getByTestId('changes-totals')).toContainText('1 accepted, 1 rejected, 0 undecided');
  // Decided changes are marked in the panels.
  await expect(page.getByTestId('panel-left').locator('del.change-rejected')).toHaveCount(1);
  await expect(page.getByTestId('panel-right').locator('ins.change-accepted').first()).toBeVisible();

  expect(docxText(await download(page))).toEqual(['The quick brown fox.', 'Second paragraph.', 'A new ending.']);
});

test('keyboard shortcuts and clicks in the panels select and decide changes', async ({ page }) => {
  const original = minimalDocx(['One two three.', 'Four five six.', 'Seven eight nine.']);
  const edited = minimalDocx(['One 2 three.', 'Four five 6.', 'Seven 8 nine.']);
  await openAndCompare(page, original, edited);
  const cards = page.getByTestId('change-card');
  await expect(cards).toHaveCount(3);

  await page.keyboard.press('j');
  await expect(cards.nth(0)).toHaveAttribute('aria-current', 'true');
  await expect(page.getByTestId('panel-left').locator('del.change-current')).toHaveText('two');
  // `r` rejects and moves on to the next undecided change.
  await page.keyboard.press('r');
  await expect(cards.nth(0)).toContainText('Rejected');
  await expect(cards.nth(1)).toHaveAttribute('aria-current', 'true');
  await page.keyboard.press('a');
  await expect(cards.nth(1)).toContainText('Accepted');
  await expect(cards.nth(2)).toHaveAttribute('aria-current', 'true');
  await page.keyboard.press('k');
  await expect(cards.nth(1)).toHaveAttribute('aria-current', 'true');
  await page.keyboard.press('u');
  await expect(cards.nth(1)).toContainText('Undecided');

  // A click on a change in the right panel selects it.
  await page.getByTestId('panel-right').locator('ins', { hasText: '8' }).click();
  await expect(cards.nth(2)).toHaveAttribute('aria-current', 'true');

  await page.keyboard.press('?');
  await expect(page.getByRole('dialog', { name: 'Help' })).toContainText('Next change');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Help' })).toBeHidden();

  // The overview bars show the changes each panel has.
  await expect(page.getByTestId('overview-left').locator('.overview-bar__mark')).toHaveCount(3);

  // Undecided changes are accepted on download.
  expect(docxText(await download(page))).toEqual(['One two three.', 'Four five 6.', 'Seven 8 nine.']);
});

test('formatting changes are one group decided for the whole document', async ({ page }) => {
  const original = minimalDocx(['Plain words here.', 'More text.']);
  const edited = minimalDocx(['Plain words here.', 'More text!']);
  // Make the first paragraph bold in the Edited document.
  const { unzipSync, zipSync, strFromU8, strToU8 } = await import('fflate');
  const files = unzipSync(edited);
  files['word/document.xml'] = strToU8(
    strFromU8(files['word/document.xml']!).replace('<w:r><w:t xml:space="preserve">Plain', '<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Plain'),
  );
  await openAndCompare(page, original, zipSync(files));

  const group = page.getByTestId('formatting-group');
  await expect(group).toContainText('Formatting changes (1)');
  await expect(page.getByRole('radio', { name: "Use the Edited's formatting" })).toBeChecked();
  await expect(page.getByTestId('change-card')).toHaveCount(1);
  await group.getByRole('button', { name: /Formatting changes/ }).click();
  const cards = page.getByTestId('change-card');
  await expect(cards).toHaveCount(2);
  const formattingCard = cards.filter({ hasText: 'Formatting' }).filter({ hasNotText: 'Replaced' });
  await expect(formattingCard).toContainText(/Bold/);
  await expect(formattingCard.getByRole('button', { name: 'Accept' })).toHaveCount(0);

  await page.getByRole('radio', { name: "Keep the Original's formatting" }).check();
  const bytes = await download(page);
  const xml = strFromU8(unzipSync(bytes)['word/document.xml']!);
  expect(xml).not.toContain('<w:b/>');
  expect(docxText(bytes)).toEqual(['Plain words here.', 'More text!']);
});

test('on the sample pair, rejecting the first text change and accepting the rest reverts that change only', async ({ page }) => {
  test.skip(!samplesAvailable, 'sample documents not present');
  const { original, edited } = readSamples();
  await openAndCompare(page, original, edited);
  // Compared in full, so that the export is the Edited text but for the rejected change.
  await page.getByRole('button', { name: 'Compare the full documents' }).click();

  const first = page.getByTestId('change-card').first();
  const cardText = async (selector: string) => {
    const element = first.locator(selector);
    return (await element.count()) > 0 ? ((await element.textContent()) ?? '') : '';
  };
  const removed = await cardText('.change-card__removed');
  const added = await cardText('.change-card__added');
  expect(removed + added).not.toBe('');
  await page.keyboard.press('j');
  await page.keyboard.press('r');
  await expect(first).toContainText('Rejected');
  await acceptAllUndecided(page);
  await expect(page.getByTestId('changes-totals')).toContainText('1 rejected, 0 undecided');

  const exported = docxText(await download(page));
  const expected = docxText(edited);
  expect(exported).toHaveLength(expected.length);
  const differing = exported.flatMap((line, i) => (line === expected[i] ? [] : [i]));
  expect(differing).toHaveLength(1);
  const at = differing[0]!;
  const words = (text: string) => text.replace(/¶/g, '').trim();
  if (words(removed)) expect(exported[at]).toContain(words(removed));
  if (words(added)) {
    expect(expected[at]).toContain(words(added));
    expect(exported[at]).not.toContain(words(added));
  }
});

test('the export dialog shows the undecided changes, and rejecting them gives the Original text', async ({ page }) => {
  const original = minimalDocx(['The quick brown fox.', 'Second paragraph.']);
  const edited = minimalDocx(['The quick red fox.', 'Second paragraph.', 'A new ending.']);
  await openAndCompare(page, original, edited);

  await page.getByRole('toolbar').getByRole('button', { name: 'Download…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Download the reviewed document' });
  await expect(dialog).toContainText('2 text changes are undecided.');
  await expect(dialog.getByLabel(/Accept undecided changes/)).toBeChecked();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();

  expect(docxText(await download(page, 'reject'))).toEqual(docxText(original));
});

test('on the sample pair, rejecting every undecided change gives the Original text once nothing is ignored', async ({ page }) => {
  test.skip(!samplesAvailable, 'sample documents not present');
  const { original, edited } = readSamples();
  await openAndCompare(page, original, edited);

  // Ignored changes take the Edited text whatever the choice; the dialog says so (53 in range,
  // 54 in the full documents).
  await page.getByRole('toolbar').getByRole('button', { name: 'Download…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Download the reviewed document' });
  await expect(dialog.getByTestId('export-ignored')).toHaveText(/^53 changes are ignored by the compare settings and take the Edited text\.$/);
  await expect(dialog.getByTestId('export-out-of-range')).toContainText('outside the comparison range');
  // The typed list numbers that became automatic numbering are formatting changes: the Original's
  // formatting keeps them as text. The choice made here is the one in the changes list.
  await dialog.getByLabel("Keep the Original's formatting").check();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('formatting-group').getByRole('radio', { name: "Keep the Original's formatting" })).toBeChecked();
  await expect(dialog).toBeHidden();

  await page.getByRole('button', { name: /Compare settings/ }).click();
  for (const setting of [/Ignore quote style/, /Ignore dash changes/, /Ignore whitespace changes/]) await page.getByLabel(setting).uncheck();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('change-summary')).toHaveText(/· 0 ignored/);

  expect(docxText(await download(page, 'reject'))).toEqual(docxText(original));
});
