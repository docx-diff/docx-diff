import { expect, test, type Page } from '@playwright/test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { minimalDocx } from '../test/minimal-docx';
import { readSamples, samplesAvailable } from '../test/samples';
import { docxText } from '../test/text';
import { downloadReviewed } from './download';
import { TWO_COLUMNS, pinView } from './viewSettings';
import { compareFull } from './rangeDialog';

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

// The view these tests were written for (the three-column view has its own tests in resolved.spec.ts).
test.beforeEach(({ page }) => pinView(page, TWO_COLUMNS));

test('rejecting the first change and accepting the rest keeps the Original text of that change only', async ({ page }) => {
  const original = minimalDocx(['The quick brown fox.', 'Second paragraph.']);
  const edited = minimalDocx(['The quick red fox.', 'Second paragraph.', 'A new ending.']);
  await openAndCompare(page, original, edited);

  const cards = page.getByTestId('change-card');
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toContainText('Replaced');
  await cards.nth(0).getByRole('button', { name: 'Reject', exact: true }).click();
  await expect(cards.nth(0)).toContainText('Rejected');
  await expect(page.getByTestId('changes-totals')).toContainText('2 text changes: 0 accepted, 1 rejected, 1 undecided');

  await acceptAllUndecided(page);
  await expect(page.getByTestId('changes-totals')).toContainText('1 accepted, 1 rejected, 0 undecided');
  // Decided changes are marked in the panels.
  await expect(page.getByTestId('panel-left').locator('del.change-rejected')).toHaveCount(1);
  await expect(page.getByTestId('panel-right').locator('ins.change-accepted').first()).toBeVisible();

  expect(docxText(await download(page))).toEqual(['The quick brown fox.', 'Second paragraph.', 'A new ending.']);
});

test('the arrow menu and A/R decide every undecided change up to here', async ({ page }) => {
  const original = minimalDocx(['One two three.', 'Four five six.', 'Seven eight nine.', 'Ten eleven twelve.']);
  const edited = minimalDocx(['One 2 three.', 'Four five 6.', 'Seven 8 nine.', 'Ten 11 twelve.']);
  await openAndCompare(page, original, edited);
  const cards = page.getByTestId('change-card');
  await expect(cards).toHaveCount(4);

  await cards.nth(0).getByRole('button', { name: 'Accept', exact: true }).click();
  await cards.nth(2).getByRole('button', { name: 'More Reject options' }).click();
  await page.getByRole('menuitem', { name: /Reject all undecided until here/ }).click();
  await expect(page.getByRole('menu')).toBeHidden();
  // The first change keeps its decision; the second and third are rejected.
  await expect(page.getByTestId('changes-totals')).toContainText('4 text changes: 1 accepted, 2 rejected, 1 undecided');
  await expect(cards.nth(1)).toContainText('Rejected');

  await page.keyboard.press('j');
  await page.keyboard.press('j');
  await expect(cards.nth(1)).toHaveAttribute('aria-current', 'true');
  await page.keyboard.press('u');
  await page.keyboard.press('j');
  await page.keyboard.press('j');
  await expect(cards.nth(3)).toHaveAttribute('aria-current', 'true');
  await page.keyboard.press('Shift+A');
  await expect(page.getByTestId('changes-totals')).toContainText('3 accepted, 1 rejected, 0 undecided');
  await expect(cards.nth(0)).toContainText('Accepted');
  await expect(cards.nth(1)).toContainText('Accepted');

  expect(docxText(await download(page))).toEqual(['One 2 three.', 'Four five 6.', 'Seven eight nine.', 'Ten 11 twelve.']);
});

test('a change decided with a comment exports it as a Word comment', async ({ page }) => {
  const original = minimalDocx(['The quick brown fox.', 'Second paragraph.']);
  const edited = minimalDocx(['The quick red fox.', 'Second paragraph.']);
  await openAndCompare(page, original, edited);
  const card = page.getByTestId('change-card').first();

  await card.getByRole('button', { name: 'More Reject options' }).click();
  await page.getByRole('menuitem', { name: 'Reject this with comment' }).click();
  await expect(card).toContainText('Rejected');
  const comment = card.getByRole('textbox', { name: 'Comment on change 1' });
  await expect(comment).toBeFocused();
  // Typing in the comment is not taken for shortcuts.
  await page.keyboard.type('Keep "brown": it is the colour in the title.');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Ask the author.');
  await expect(card).toContainText('Rejected');

  const exported = await download(page);
  expect(docxText(exported)).toEqual(['The quick brown fox.', 'Second paragraph.']);
  const files = unzipSync(exported);
  const comments = strFromU8(files['word/comments.xml']!);
  const paragraphs = [...comments.matchAll(/<w:p\/>|<w:p>(.*?)<\/w:p>/g)].map(([, p = '']) => [...p.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(([, t]) => t).join(''));
  expect(paragraphs).toEqual(['Rejected:', '', 'Changed from', 'brown', 'to', 'red', '', 'Comment:', 'Keep "brown": it is the colour in the title.', 'Ask the author.']);
  expect(strFromU8(files['word/document.xml']!)).toMatch(/<w:commentRangeStart w:id="0"\/><w:r>.*?brown.*?<w:commentRangeEnd w:id="0"\/><w:r><w:commentReference w:id="0"\/><\/w:r>/);

  await card.getByRole('button', { name: 'Remove comment' }).click();
  await expect(card.getByRole('textbox')).toHaveCount(0);
  await expect(card).toContainText('Rejected');
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

  // A click on a change in the right panel selects it (once the current change's card, which can
  // cover the next line, is closed).
  await page.getByTestId('panel-right').getByRole('button', { name: 'Hide this card' }).click();
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

test('the current change has its card under it in the Edited panel, and the changes list can be hidden', async ({ page }) => {
  const original = minimalDocx(['One two three.', 'Four five six.', 'Seven eight nine.']);
  const edited = minimalDocx(['One 2 three.', 'Four five 6.', 'Seven 8 nine.']);
  await openAndCompare(page, original, edited);
  const right = page.getByTestId('panel-right');
  const card = right.getByTestId('inline-change-card');
  const cards = page.getByTestId('change-card');
  await expect(card).toHaveCount(0);

  // A click on a change in the text shows its card below it, with space for reading between.
  const six = right.locator('ins.rev-ins', { hasText: '6' });
  await six.click();
  await expect(card).toContainText('six');
  const changeBox = (await six.boundingBox())!;
  const cardBox = (await card.boundingBox())!;
  expect(cardBox.y - (changeBox.y + changeBox.height)).toBeGreaterThan(16);
  await card.getByRole('button', { name: 'Reject', exact: true }).click();
  await expect(card).toContainText('Rejected');
  await expect(cards.nth(1)).toContainText('Rejected');

  // × hides it until the next selection; so does Escape.
  await card.getByRole('button', { name: 'Hide this card' }).click();
  await expect(card).toHaveCount(0);
  await page.keyboard.press('j');
  await expect(card).toContainText('eight');
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);

  // Selecting in the list shows it too.
  await cards.nth(0).click();
  await expect(card).toContainText('two');

  // With the list hidden, the card still decides.
  await page.getByRole('button', { name: 'Hide the changes list' }).click();
  await expect(page.getByTestId('changes-list')).toHaveCount(0);
  await card.getByRole('button', { name: 'Accept', exact: true }).click();
  await page.getByRole('button', { name: /Changes · 1 undecided/ }).click();
  await expect(page.getByTestId('changes-list')).toBeVisible();
  await expect(cards.nth(0)).toContainText('Accepted');

  // Turned off in the settings, no card is shown.
  await page.getByRole('button', { name: /Compare settings/ }).click();
  await page.getByLabel(/Show the change card/).uncheck();
  await page.keyboard.press('Escape');
  await page.keyboard.press('j');
  await expect(cards.nth(1)).toHaveAttribute('aria-current', 'true');
  await expect(card).toHaveCount(0);
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
  await expect(group).toHaveCount(0);
  await page.getByRole('button', { name: /^Fmt/ }).click();
  await expect(group).toContainText('Formatting changes (1)');
  await expect(page.getByRole('radio', { name: "Use the Edited's formatting" })).toBeChecked();
  await expect(page.getByTestId('change-card')).toHaveCount(1);
  await group.getByRole('button', { name: /Formatting changes/ }).click();
  const cards = page.getByTestId('change-card');
  await expect(cards).toHaveCount(2);
  const formattingCard = cards.filter({ hasText: 'Formatting' }).filter({ hasNotText: 'Replaced' });
  await expect(formattingCard).toContainText(/Bold/);
  await expect(formattingCard.getByRole('button', { name: 'Accept', exact: true })).toHaveCount(0);

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
  await compareFull(page);

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

test('undecided changes export as Word tracked changes by the Edited’s author, with their comments', async ({ page }) => {
  const original = minimalDocx(['The quick brown fox.', 'Second paragraph.', 'A third one.']);
  const files = unzipSync(minimalDocx(['The quick red fox.', 'Second paragraph.', 'A new third one.']));
  files['docProps/core.xml'] = strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>Someone</dc:creator><cp:lastModifiedBy>Ann Editor</cp:lastModifiedBy></cp:coreProperties>',
  );
  await openAndCompare(page, original, zipSync(files));
  const [first, second] = [page.getByTestId('change-card').nth(0), page.getByTestId('change-card').nth(1)];

  await first.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect(first).toContainText('Accepted');
  await first.getByRole('button', { name: 'More Reject options' }).click();
  await page.getByRole('menuitem', { name: 'Undecided with comment' }).click();
  await expect(first).toContainText('Undecided');
  await expect(first.getByRole('textbox', { name: 'Comment on change 1' })).toBeFocused();
  await page.keyboard.type('Ask the author.');
  await second.getByRole('button', { name: 'Reject', exact: true }).click();

  await page.getByRole('toolbar').getByRole('button', { name: 'Download…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Download the reviewed document' });
  await expect(dialog.getByLabel('Author of the comments and tracked changes')).toHaveValue('Ann Editor');
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  const exported = await downloadReviewed(page, 'track');
  const parts = unzipSync(exported.bytes);
  const body = strFromU8(parts['word/document.xml']!);
  expect(body).toMatch(/<w:del [^>]*w:author="Ann Editor"[^>]*>.*?brown/);
  expect(body).toMatch(/<w:ins [^>]*w:author="Ann Editor"[^>]*>.*?red/);
  // The decided change is applied, untracked.
  expect(docxText(exported.bytes)[2]).toBe('A third one.');
  const comments = strFromU8(parts['word/comments.xml']!);
  expect(comments).toContain('w:author="Ann Editor"');
  expect(comments).toContain('>Undecided:<');
  expect(comments).toContain('>Ask the author.<');

  // The next download remembers the choice; another author can be given.
  const again = await downloadReviewed(page, 'track', 'Bo Reviewer');
  expect(strFromU8(unzipSync(again.bytes)['word/document.xml']!)).toContain('w:author="Bo Reviewer"');
  expect(strFromU8(unzipSync(again.bytes)['word/document.xml']!)).not.toContain('Ann Editor');
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

  // Ignored changes take the Edited text whatever the choice; the dialog says so (54, all in range:
  // the bare paragraph mark after the deleted tail is in range and ignored by the whitespace setting).
  await page.getByRole('toolbar').getByRole('button', { name: 'Download…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Download the reviewed document' });
  await expect(dialog.getByTestId('export-ignored')).toHaveText(/^54 changes are ignored by the compare settings and take the Edited text\.$/);
  await expect(dialog.getByTestId('export-out-of-range')).toContainText('outside the comparison range');
  // The typed list numbers that became automatic numbering are formatting changes: the Original's
  // formatting keeps them as text. The choice made here is the one in the changes list.
  await dialog.getByLabel("Keep the Original's formatting").check();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: /^Fmt/ }).click();
  await expect(page.getByTestId('formatting-group').getByRole('radio', { name: "Keep the Original's formatting" })).toBeChecked();

  await page.getByRole('button', { name: /Compare settings/ }).click();
  for (const setting of [/Ignore quote style/, /Ignore dash changes/, /Ignore whitespace changes/]) await page.getByLabel(setting).uncheck();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('changes-totals')).not.toContainText('ignored');

  expect(docxText(await download(page, 'reject'))).toEqual(docxText(original));
});

test('the outline lists the headings and scrolls both panels to one', async ({ page }) => {
  const filler = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => `${prefix} paragraph ${i + 1}.`);
  const original = minimalDocx([{ heading: 1, text: 'Introduction' }, ...filler(60, 'Intro'), { heading: 2, text: 'Details' }, ...filler(60, 'Detail')]);
  const edited = minimalDocx([
    { heading: 1, text: 'Introduction' },
    ...filler(60, 'Intro'),
    { heading: 2, text: 'Added section' },
    'A new paragraph.',
    { heading: 2, text: 'Details' },
    ...filler(60, 'Detail'),
  ]);
  await openAndCompare(page, original, edited);

  const outline = page.getByTestId('outline');
  await expect(outline.getByRole('button')).toHaveText(['Introduction', 'Added section', 'Details']);
  await expect(outline.getByRole('button', { name: 'Added section' })).toHaveClass(/outline__entry--inserted/);

  // Each panel puts the heading near its top, whatever the scroll lock.
  await page.getByRole('button', { name: 'Scroll lock' }).click();
  await outline.getByRole('button', { name: 'Details' }).click();
  for (const side of ['left', 'right']) {
    const panel = page.getByTestId(`panel-${side}`);
    const heading = panel.locator('h2', { hasText: 'Details' });
    const offset = (await heading.boundingBox())!.y - (await panel.boundingBox())!.y;
    expect(offset).toBeGreaterThan(0);
    expect(offset).toBeLessThan(40);
  }

  // A heading only the Edited has: the Original's panel is aligned with the Edited's.
  await outline.getByRole('button', { name: 'Introduction' }).click();
  await outline.getByRole('button', { name: 'Added section' }).click();
  const right = page.getByTestId('panel-right');
  const added = right.locator('h2', { hasText: 'Added section' });
  expect((await added.boundingBox())!.y - (await right.boundingBox())!.y).toBeLessThan(40);
  await expect.poll(() => page.getByTestId('panel-left').evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

  // Collapsible.
  await page.getByRole('button', { name: 'Hide the outline' }).click();
  await expect(outline).toHaveCount(0);
  await page.getByRole('button', { name: /Outline/ }).click();
  await expect(outline).toBeVisible();
});
