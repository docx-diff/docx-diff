import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { minimalDocx } from '../test/minimal-docx';
import { readSamples, samplesAvailable } from '../test/samples';
import { docxText } from '../test/text';
import { downloadReviewed } from './download';
import { TWO_COLUMNS, pinView } from './viewSettings';

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const SIMPLE = 'Only simple edits within a paragraph are supported, to keep the comparison fast.';

async function openAndCompare(page: Page, original: Uint8Array, edited: Uint8Array) {
  await page.goto('');
  await expect(page.getByRole('status').filter({ hasText: /Engine/ })).toHaveText(/Engine ready/, { timeout: 60_000 });
  await page.getByLabel('Original document').setInputFiles({ name: 'original.docx', mimeType: DOCX_TYPE, buffer: Buffer.from(original) });
  await page.getByLabel('Edited document').setInputFiles({ name: 'edited.docx', mimeType: DOCX_TYPE, buffer: Buffer.from(edited) });
  await expect(page.getByTestId('panel-right')).toBeVisible({ timeout: 60_000 });
}

const fixture = (name: string, version: 'original' | 'edited') => new Uint8Array(readFileSync(`test/fixtures/${name}.${version}.docx`));

const cards = (page: Page) => page.getByTestId('change-card');
const totals = (page: Page) => page.getByTestId('changes-totals');
const toast = (page: Page) => page.locator('.toast');
const paragraph = (page: Page, side: 'left' | 'right' | 'resolved', text: string) =>
  page.getByTestId(`panel-${side}`).locator('p', { hasText: text });
/** The text the panel shows (deletions are hidden in the Edited panel), spaces normalized. */
const shown = async (page: Page, side: 'left' | 'right' | 'resolved', text: string) =>
  (await paragraph(page, side, text).innerText()).replace(/\s+/g, ' ').trim();

async function startEditing(page: Page) {
  const toggle = page.getByRole('button', { name: 'Editable' });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
}

/** Puts the cursor at the end of the Edited panel's paragraph. */
async function cursorAtEnd(page: Page, text: string) {
  await paragraph(page, 'right', text).click();
  await page.keyboard.press('Control+End');
}

/** Selects `word` (its first occurrence outside insertions) in the Edited panel's paragraph. */
async function selectWord(page: Page, text: string, word: string) {
  await paragraph(page, 'right', text).evaluate((block, word) => {
    (block as HTMLElement).focus();
    const walker = block.ownerDocument.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.textContent!.indexOf(word);
      if (at < 0 || node.parentElement!.closest('ins, del')) continue;
      block.ownerDocument.getSelection()!.setBaseAndExtent(node, at, node, at + word.length);
      return;
    }
    throw new Error(`No ${word}`);
  }, word);
}

test.describe('two columns', () => {
  test.beforeEach(({ page }) => pinView(page, TWO_COLUMNS));

  test('Editable is off by default; typing a word gives a new accepted change, and the cursor stays', async ({ page }) => {
    await openAndCompare(page, minimalDocx(['The quick brown fox.', 'Second paragraph.']), minimalDocx(['The quick red fox.', 'Second paragraph.']));
    await expect(cards(page)).toHaveCount(1);
    const toggle = page.getByRole('button', { name: 'Editable' });
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(toggle).toHaveAttribute('title', 'Edit the Edited text (simple edits within a paragraph)');
    await expect(paragraph(page, 'right', 'Second paragraph.')).not.toHaveAttribute('contenteditable');
    await page.keyboard.press('j');
    await expect(page.locator('.inline-card')).toBeVisible();

    await startEditing(page);
    await expect(toggle).toHaveAttribute('title', 'Stop editing');
    // The current change's card doesn't cover the text being edited.
    await expect(page.locator('.inline-card')).toHaveCount(0);
    await expect(paragraph(page, 'right', 'Second paragraph.')).toHaveAttribute('contenteditable', 'true');

    await cursorAtEnd(page, 'Second paragraph.');
    await page.keyboard.type(' Really');
    await expect(cards(page)).toHaveCount(2);
    await expect(totals(page)).toContainText('1 accepted, 0 rejected, 1 undecided');
    await expect(page.getByTestId('panel-right').locator('ins', { hasText: 'Really' })).toBeVisible();
    expect(await shown(page, 'left', 'Second paragraph.')).toBe('Second paragraph.');
    // The cursor is where it was after the update: typing on continues the word, in the same change.
    await page.keyboard.type('ly');
    await expect(cards(page).nth(1)).toContainText('Reallyly');
    await expect(cards(page)).toHaveCount(2);
    expect(await shown(page, 'right', 'Second paragraph.')).toBe('Second paragraph. Reallyly');

    // Turned off: the text can't be edited, a click selects a change again.
    await toggle.click();
    await expect(paragraph(page, 'right', 'Second paragraph.')).not.toHaveAttribute('contenteditable');
  });

  test('a space typed, then after an update a word, is one change', async ({ page }) => {
    await openAndCompare(page, minimalDocx(['The quick brown fox.', 'Second paragraph.']), minimalDocx(['The quick red fox.', 'Second paragraph.']));
    await startEditing(page);
    await cursorAtEnd(page, 'Second paragraph');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.type(' ');
    await expect(cards(page)).toHaveCount(2);
    await page.waitForTimeout(600);
    await page.keyboard.type('long');
    await expect(cards(page).nth(1)).toContainText('long');
    await expect(cards(page)).toHaveCount(2);
    expect(await shown(page, 'right', 'Second')).toBe('Second paragraph long.');
    await page.getByRole('button', { name: 'Editable' }).click();
    await expect(page.getByTestId('panel-right').locator('.edit-revert')).toHaveCount(1);
  });

  test('fixing a typo inside an insertion keeps the change and its decision', async ({ page }) => {
    await openAndCompare(page, minimalDocx(['We saw it.']), minimalDocx(['We saw it clearlly.']));
    await expect(cards(page)).toHaveCount(1);
    await cards(page).nth(0).getByRole('button', { name: 'Reject', exact: true }).click();
    await startEditing(page);
    await cursorAtEnd(page, 'We saw it');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Backspace');
    await expect(cards(page).nth(0)).toContainText('clearly');
    await expect(cards(page).nth(0)).not.toContainText('clearlly');
    await expect(cards(page)).toHaveCount(1);
    await expect(totals(page)).toContainText('0 accepted, 1 rejected, 0 undecided');
  });

  test('a word changed between two decided insertions is a new change; their decisions stay', async ({ page }) => {
    await openAndCompare(page, minimalDocx(['the red one.']), minimalDocx(['the big red house one.']));
    await expect(cards(page)).toHaveCount(2);
    await cards(page).nth(0).getByRole('button', { name: 'Accept', exact: true }).click();
    await cards(page).nth(1).getByRole('button', { name: 'Reject', exact: true }).click();
    await startEditing(page);
    await selectWord(page, 'the', 'red');
    await page.keyboard.type('blue');
    await expect(cards(page)).toHaveCount(3);
    await expect(totals(page)).toContainText('2 accepted, 1 rejected, 0 undecided');
    await expect(cards(page).nth(0)).toContainText('Accepted');
    await expect(cards(page).nth(1)).toContainText('blue');
    await expect(cards(page).nth(1)).toContainText('Accepted');
    await expect(cards(page).nth(2)).toContainText('Rejected');
  });

  test('blocked actions show their message and leave the text as it was', async ({ page }) => {
    await openAndCompare(page, minimalDocx(['First paragraph here.', 'Second paragraph.']), minimalDocx(['First paragraph here.', 'Second paragraph.', 'Added.']));
    await startEditing(page);
    await cursorAtEnd(page, 'Second paragraph.');
    await page.keyboard.press('Enter');
    await expect(toast(page)).toHaveText(`${SIMPLE} Paragraph breaks can’t be added here.`);
    await page.keyboard.press('Delete');
    await expect(toast(page)).toHaveText(`${SIMPLE} Paragraphs can’t be joined here.`);
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('Backspace');
    await expect(toast(page)).toHaveText(`${SIMPLE} Paragraphs can’t be joined here.`);

    // A selection from one paragraph into the next.
    await page.getByTestId('panel-right').evaluate((host) => {
      const [first, second] = host.shadowRoot!.querySelectorAll('p');
      (first as HTMLElement).focus();
      const text = (block: Element) => block.ownerDocument.createTreeWalker(block, NodeFilter.SHOW_TEXT).nextNode()!;
      host.ownerDocument.getSelection()!.setBaseAndExtent(text(first!), 2, text(second!), 3);
    });
    await page.keyboard.type('x');
    await expect(toast(page)).toHaveText(`${SIMPLE} Edits must stay within one paragraph.`);

    // A paragraph with an inserted mark can be edited too (a moved one can't: below).
    await expect(paragraph(page, 'right', 'Added.')).toHaveAttribute('contenteditable', 'true');
    await page.waitForTimeout(600);
    expect(await shown(page, 'right', 'First paragraph')).toBe('First paragraph here.');
    expect(await shown(page, 'right', 'Second paragraph')).toBe('Second paragraph.');
    await expect(cards(page)).toHaveCount(1);
  });

  test('a footnote reference can’t be deleted, and a moved paragraph can’t be edited', async ({ page }) => {
    await openAndCompare(page, fixture('footnote-edit', 'original'), fixture('footnote-edit', 'edited'));
    await startEditing(page);
    const first = page.getByTestId('panel-right').locator('p[contenteditable="true"]').first();
    await first.click();
    await page.keyboard.press('Control+End');
    const before = await first.innerText();
    await page.keyboard.press('Backspace');
    await expect(toast(page)).toHaveText('Footnote references and other objects can’t be deleted here.');
    await page.waitForTimeout(600);
    expect(await first.innerText()).toBe(before);

    await openAndCompare(page, fixture('move', 'original'), fixture('move', 'edited'));
    await startEditing(page);
    await page.getByTestId('panel-right').locator('p:has(ins.rev-move-to)').click();
    await expect(toast(page)).toHaveText('This paragraph can’t be edited here: it contains a moved passage.');
  });

  test('keys typed into the text are text, not shortcuts', async ({ page }) => {
    await openAndCompare(page, minimalDocx(['The quick brown fox.', 'Second paragraph.']), minimalDocx(['The quick red fox.', 'Second paragraph.']));
    await startEditing(page);
    await cursorAtEnd(page, 'Second paragraph.');
    await page.keyboard.type(' arju?');
    await expect(cards(page)).toHaveCount(2);
    expect(await shown(page, 'right', 'Second paragraph.')).toBe('Second paragraph. arju?');
    await expect(cards(page).nth(0)).toContainText('Undecided');
    await expect(page.getByRole('dialog', { name: 'Help' })).toHaveCount(0);
    // Escape leaves the text: the shortcuts work again.
    await page.keyboard.press('Escape');
    await page.keyboard.press('j');
    await expect(cards(page).nth(0)).toHaveAttribute('aria-current', 'true');
  });

  test('a character composed with a dead key gives one update, after the composition', async ({ page }) => {
    await openAndCompare(page, minimalDocx(['Egy két három.']), minimalDocx(['Egy két három.', 'Más.']));
    await startEditing(page);
    await cursorAtEnd(page, 'Egy két');
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.imeSetComposition', { text: '˝', selectionStart: 1, selectionEnd: 1 });
    await page.waitForTimeout(800);
    await expect(cards(page)).toHaveCount(1);
    await cdp.send('Input.insertText', { text: 'ő' });
    await expect(cards(page)).toHaveCount(2);
    await expect(cards(page).nth(0)).toContainText('ő');
    await expect(cards(page).nth(0)).not.toContainText('˝');
  });
  test('pasted text goes in as plain text, line breaks and tabs as spaces', async ({ page }) => {
    await openAndCompare(page, minimalDocx(['The quick brown fox.', 'Second paragraph.']), minimalDocx(['The quick red fox.', 'Second paragraph.']));
    await startEditing(page);
    await cursorAtEnd(page, 'Second paragraph.');
    await paragraph(page, 'right', 'Second paragraph.').evaluate((block) => {
      const data = new DataTransfer();
      data.setData('text/plain', ' one\ntwo\tthree');
      data.setData('text/html', '<b>one</b>');
      block.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, composed: true, cancelable: true }));
    });
    await expect(cards(page)).toHaveCount(2);
    expect(await shown(page, 'right', 'Second paragraph.')).toBe('Second paragraph. one two three');
    await expect(paragraph(page, 'right', 'Second paragraph.').locator('b')).toHaveCount(0);
    // The cursor is after the pasted text.
    await page.keyboard.type('!');
    await expect(cards(page).nth(1)).toContainText('three!');
  });

  test('typed text is applied when Editable is turned off, when the text loses focus, and before typing elsewhere in it', async ({ page }) => {
    await openAndCompare(page, minimalDocx(['The quick brown fox.', 'Second paragraph.']), minimalDocx(['The quick red fox.', 'Second paragraph.']));
    await startEditing(page);
    await cursorAtEnd(page, 'Second paragraph.');
    await page.keyboard.type(' Aa');
    await page.getByRole('button', { name: 'Editable' }).click();
    await expect(cards(page)).toHaveCount(2);
    expect(await shown(page, 'right', 'Second paragraph.')).toBe('Second paragraph. Aa');

    await startEditing(page);
    await cursorAtEnd(page, 'Second paragraph.');
    await page.keyboard.type(' Bb');
    await paragraph(page, 'right', 'The quick').click();
    // Typed on right after the earlier edit's insertion: the same change.
    await expect(cards(page).nth(1)).toContainText('Aa Bb');
    await expect(cards(page)).toHaveCount(2);
    expect(await shown(page, 'right', 'Second paragraph.')).toBe('Second paragraph. Aa Bb');

    // Two places in one paragraph within the update's delay: both edits are kept.
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' Cc');
    await page.keyboard.press('Control+Home');
    await page.keyboard.type('Dd ');
    await expect.poll(() => shown(page, 'right', 'fox.')).toBe('Dd The quick red fox. Cc');
    await expect(cards(page)).toHaveCount(4);
    // The editor's change between them is untouched (one span would have replaced it).
    await expect(cards(page).filter({ hasText: 'brown' })).toHaveCount(1);
    await expect(cards(page).filter({ hasText: 'brown' })).toContainText('red');
    expect(await shown(page, 'left', 'fox.')).toBe('The quick brown fox.');
  });

  test('editing a heading keeps it in the outline, with its new text', async ({ page }) => {
    await openAndCompare(
      page,
      minimalDocx([{ heading: 1, text: 'Introduction' }, 'Body text.']),
      minimalDocx([{ heading: 1, text: 'Introduction' }, 'Body text changed.']),
    );
    await startEditing(page);
    await page.getByTestId('panel-right').locator('h1', { hasText: 'Introduction' }).click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' part');
    await expect(cards(page)).toHaveCount(2);
    await expect(page.getByTestId('outline')).toContainText('Introduction part');
  });
  test('joined paragraphs are edited one by one, and joined again when Editable is turned off', async ({ page }) => {
    await openAndCompare(page, fixture('paragraph-join', 'original'), fixture('paragraph-join', 'edited'));
    const right = page.getByTestId('panel-right');
    await expect(right.locator('p.merged-into-next')).toHaveCount(2);
    const joined = await right.locator('p', { hasText: 'The monastery stood' }).innerText();
    await startEditing(page);
    await expect(right.locator('p.merged-into-next')).toHaveCount(0);
    const first = right.locator('p[contenteditable="true"]', { hasText: 'The monastery stood' });
    await expect(first.locator('.rev-para-mark-del')).toBeVisible();
    await first.click();
    await page.keyboard.press('Control+End');
    // After the space the Edited put where the paragraphs join.
    await page.keyboard.type('Indeed. ');
    await expect(cards(page).filter({ hasText: 'Indeed.' })).toHaveCount(1);
    await expect(toast(page)).toHaveText('');
    await page.getByRole('button', { name: 'Editable' }).click();
    await expect(right.locator('p.merged-into-next')).toHaveCount(2);
    expect((await right.locator('p', { hasText: 'The monastery stood' }).innerText()).replace(/\s+/g, ' ')).toBe(
      joined.replace(/\s+/g, ' ').replace('began. ', 'began. Indeed. '),
    );
    // The edit's ↺ is back with Editable off, moved with its paragraph's text into the one it joins.
    const icon = right.locator('p:not(.merged-into-next) ins:has-text("Indeed.") + .edit-revert');
    await expect(icon).toBeVisible();
    const text = docxText((await downloadReviewed(page, 'accept')).bytes);
    expect(text[0]).toContain('the path began. Indeed. Every morning');
  });

  test('typing in one joined paragraph, then at once in the next one of its run, keeps both', async ({ page }) => {
    await openAndCompare(page, fixture('paragraph-join', 'original'), fixture('paragraph-join', 'edited'));
    const right = page.getByTestId('panel-right');
    await startEditing(page);
    const editable = right.locator('p[contenteditable="true"]');
    await editable.filter({ hasText: 'The monastery stood' }).click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('Xx.');
    // Within the update's delay: the first paragraph's update must not take the cursor away.
    await editable.filter({ hasText: 'Every morning' }).click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' Yy.');
    await expect(cards(page).filter({ hasText: 'Yy.' })).toHaveCount(1);
    await expect(cards(page).filter({ hasText: 'Xx.' })).toHaveCount(1);
    expect(await shown(page, 'right', 'Every morning')).toContain('alms food. Yy.');
  });

  test('a paragraph the Original panel joins (split in the Edited) can be edited; the Original keeps its text', async ({ page }) => {
    await openAndCompare(page, fixture('paragraph-split', 'original'), fixture('paragraph-split', 'edited'));
    const left = await page.getByTestId('panel-left').locator('p', { hasText: 'The monastery stood' }).innerText();
    await startEditing(page);
    await cursorAtEnd(page, 'Every morning');
    await page.keyboard.type(' Always.');
    await expect(cards(page).filter({ hasText: 'Always.' })).toHaveCount(1);
    expect(await page.getByTestId('panel-left').locator('p', { hasText: 'The monastery stood' }).innerText()).toBe(left);
    // The Original panel's join is redone with the edit in it.
    await expect(page.getByTestId('panel-left').locator('p.merged-into-next')).toHaveCount(1);
    const text = docxText((await downloadReviewed(page, 'accept')).bytes);
    expect(text).toEqual(docxText(fixture('paragraph-split', 'edited')).map((paragraph) => paragraph.replace('alms food.', 'alms food. Always.')));
  });

  test('on the sample pair, a paragraph whose blank line the editor removed can be edited', async ({ page }) => {
    test.skip(!samplesAvailable, 'sample documents not present');
    const { original, edited } = readSamples();
    await openAndCompare(page, original, edited);
    // The Display setting (on by default): no justified text, also once the joined paragraphs are shown one by one.
    const justified = (side: 'left' | 'right') =>
      page.getByTestId(`panel-${side}`).evaluate((host) => [...host.shadowRoot!.querySelectorAll('p, h1, h2, h3')].filter((block) => getComputedStyle(block).textAlign === 'justify').length);
    expect(await justified('left')).toBe(0);
    expect(await justified('right')).toBe(0);
    await startEditing(page);
    expect(await justified('right')).toBe(0);
    const right = page.getByTestId('panel-right');
    // The empty paragraph it was joined into is hidden while editing.
    await expect(right.locator('p.unjoined-empty').first()).toBeHidden();
    // The paragraph shown in its place keeps its spacing (which replaced the removed blank line).
    const spacing = await page.getByTestId('panel-right').evaluate((host) => {
      const margins = (block: Element) => ['marginTop', 'marginBottom'].map((side) => getComputedStyle(block)[side as 'marginTop']).join(' ');
      const pairs = [...host.shadowRoot!.querySelectorAll('.unjoined-empty')].flatMap((empty) => {
        const shown = empty.previousElementSibling;
        return shown?.matches('p.rev-para-del:not(.not-in-edited)') ? [[margins(shown), margins(empty)]] : [];
      });
      return { pairs: pairs.length, differing: pairs.filter(([shown, empty]) => shown !== empty).length };
    });
    expect(spacing.pairs).toBe(40);
    expect(spacing.differing).toBe(0);
    const target = right.locator('p.rev-para-del[contenteditable="true"]').nth(3);
    await target.scrollIntoViewIfNeeded();
    const before = (await target.innerText()).trim();
    await target.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' Szerkesztve.');
    await page.keyboard.press('Escape');
    await expect(toast(page)).toHaveText('');
    expect((await target.innerText()).trim()).toBe(`${before} Szerkesztve.`);
    await page.getByRole('button', { name: 'Editable' }).click();
    await expect(right.locator('p', { hasText: 'Szerkesztve.' })).toHaveCount(1);
    await expect(right.locator('p.unjoined-empty')).toHaveCount(0);
  });
});

test.describe('revert and guards', () => {
  test.beforeEach(({ page }) => pinView(page, TWO_COLUMNS));

  const dialog = (page: Page, name: string) => page.getByRole('dialog', { name });
  const revertParagraph = (page: Page) => page.getByRole('button', { name: 'Revert my edits in this paragraph' });
  const revertAll = (page: Page) => page.getByRole('button', { name: 'Revert all my edits' });

  test('one change is reverted by its ↺ (Editable off) or its card, after a confirmation; the rest of the paragraph stays', async ({ page }) => {
    await openAndCompare(page, minimalDocx(['The quick brown fox.', 'Second paragraph here.']), minimalDocx(['The quick red fox.', 'Second paragraph here.']));
    await startEditing(page);
    await cursorAtEnd(page, 'Second paragraph');
    await page.keyboard.type(' Really');
    await expect(cards(page)).toHaveCount(2);
    await selectWord(page, 'Second paragraph', 'paragraph');
    await page.keyboard.type('line');
    await expect(cards(page)).toHaveCount(3);
    // No undo while typing: Ctrl+Z says what to use instead.
    await page.keyboard.press('Control+z');
    await expect(toast(page)).toHaveText('Undo isn’t available here: use ↺ to revert your edits.');

    // No ↺ in the text while editing (it would trap the cursor); back with Editable off.
    const right = page.getByTestId('panel-right');
    await expect(right.locator('.edit-revert')).toHaveCount(0);
    await page.getByRole('button', { name: 'Editable' }).click();
    await expect(right.locator('.edit-revert')).toHaveCount(2);
    const icon = right.locator('ins:has-text("Really") + .edit-revert');
    await expect(icon).toHaveAttribute('title', 'Revert my edit of this change');
    await icon.click();
    await expect(dialog(page, 'Revert your edit of this change?')).toContainText('This can’t be undone.');
    await dialog(page, 'Revert your edit of this change?').getByRole('button', { name: 'Cancel' }).click();
    await expect(cards(page)).toHaveCount(3);
    await icon.click();
    await dialog(page, 'Revert your edit of this change?').getByRole('button', { name: 'Revert' }).click();
    await expect(cards(page)).toHaveCount(2);
    await expect.poll(() => shown(page, 'right', 'Second')).toBe('Second line here.');

    // The comparison's own change has no Revert; the edit's card does.
    await expect(cards(page).nth(0).getByRole('button', { name: 'Revert my edit of this change' })).toHaveCount(0);
    await cards(page).nth(1).getByRole('button', { name: 'Revert my edit of this change' }).click();
    await dialog(page, 'Revert your edit of this change?').getByRole('button', { name: 'Revert' }).click();
    await expect(cards(page)).toHaveCount(1);
    await expect(right.locator('.edit-revert')).toHaveCount(0);
    expect(await shown(page, 'right', 'Second')).toBe('Second paragraph here.');
    expect(await shown(page, 'left', 'Second')).toBe('Second paragraph here.');
  });

  test('↺ ¶ reverts the cursor’s paragraph (the current change’s with Editable off), ↺ all every edit', async ({ page }) => {
    await openAndCompare(
      page,
      minimalDocx(['Alpha beta gamma.', 'Delta epsilon zeta.', 'Eta theta iota.']),
      minimalDocx(['Alpha beta gamma.', 'Delta epsilon zeta.', 'Eta theta iota kappa.']),
    );
    await expect(revertParagraph(page)).toBeDisabled();
    await expect(revertAll(page)).toBeDisabled();
    await startEditing(page);
    await cursorAtEnd(page, 'Alpha');
    await page.keyboard.type(' one');
    await expect(cards(page)).toHaveCount(2);
    await cursorAtEnd(page, 'Delta');
    await page.keyboard.type(' two');
    await expect(cards(page)).toHaveCount(3);
    await expect(revertParagraph(page)).toBeEnabled();

    await revertParagraph(page).click();
    const paragraphDialog = dialog(page, 'Revert your edits in this paragraph?');
    await expect(paragraphDialog).toContainText('This can’t be undone.');
    await paragraphDialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(cards(page)).toHaveCount(3);
    await revertParagraph(page).click();
    await paragraphDialog.getByRole('button', { name: 'Revert' }).click();
    await expect(cards(page)).toHaveCount(2);
    await expect.poll(() => shown(page, 'right', 'Delta')).toBe('Delta epsilon zeta.');
    expect(await shown(page, 'right', 'Alpha')).toBe('Alpha beta gamma. one');
    // The cursor's paragraph has no edits left; another one has.
    await expect(revertParagraph(page)).toBeDisabled();
    await expect(revertAll(page)).toBeEnabled();

    // Editable off: the current change's paragraph.
    await page.getByRole('button', { name: 'Editable' }).click();
    await expect(revertParagraph(page)).toBeDisabled();
    await cards(page).nth(0).click();
    await expect(revertParagraph(page)).toBeEnabled();
    await cards(page).nth(1).click();
    await expect(revertParagraph(page)).toBeDisabled();
    await cards(page).nth(0).click();
    await revertParagraph(page).click();
    await paragraphDialog.getByRole('button', { name: 'Revert' }).click();
    await expect(cards(page)).toHaveCount(1);
    await expect(revertParagraph(page)).toBeDisabled();
    await expect(revertAll(page)).toBeDisabled();

    // ↺ all, with the number of paragraphs.
    await startEditing(page);
    await cursorAtEnd(page, 'Alpha');
    await page.keyboard.type(' one');
    await cursorAtEnd(page, 'Delta');
    await page.keyboard.type(' two');
    await expect(cards(page)).toHaveCount(3);
    await revertAll(page).click();
    const allDialog = dialog(page, 'Revert your edits in 2 paragraphs?');
    await allDialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(cards(page)).toHaveCount(3);
    await revertAll(page).click();
    await allDialog.getByRole('button', { name: 'Revert all' }).click();
    await expect(cards(page)).toHaveCount(1);
    await expect(revertAll(page)).toBeDisabled();
    expect(await shown(page, 'right', 'Alpha')).toBe('Alpha beta gamma.');
    expect(await shown(page, 'right', 'Delta')).toBe('Delta epsilon zeta.');
  });

  test('Swap and opening another file ask first when there are edits; Swap discards them', async ({ page }) => {
    await openAndCompare(page, minimalDocx(['The quick brown fox.', 'Second paragraph.']), minimalDocx(['The quick red fox.', 'Second paragraph.']));
    await startEditing(page);
    await cursorAtEnd(page, 'Second paragraph.');
    await page.keyboard.type(' More');
    await expect(cards(page)).toHaveCount(2);
    await page.getByRole('button', { name: 'Swap' }).click();
    const swapDialog = dialog(page, 'Swap the documents?');
    await expect(swapDialog).toContainText('Swapping discards your edits in 1 paragraph.');
    await swapDialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(cards(page)).toHaveCount(2);
    expect(await shown(page, 'right', 'Second paragraph.')).toBe('Second paragraph. More');
    // Opening another file with the toolbar's picker asks too.
    await page.getByLabel('Original document').setInputFiles({ name: 'other.docx', mimeType: DOCX_TYPE, buffer: Buffer.from(minimalDocx(['Other.'])) });
    const fileDialog = dialog(page, 'Open another file?');
    await expect(fileDialog).toContainText('Opening another file discards your edits in 1 paragraph.');
    await fileDialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(cards(page)).toHaveCount(2);
    await page.getByRole('button', { name: 'Swap' }).click();
    await swapDialog.getByRole('button', { name: 'Swap' }).click();
    await expect.poll(() => shown(page, 'right', 'The quick')).toBe('The quick brown fox.');
    await expect(cards(page)).toHaveCount(1);
    expect(await shown(page, 'right', 'Second paragraph.')).toBe('Second paragraph.');
    await expect(revertAll(page)).toBeDisabled();
  });

  test('moving the end point over edited paragraphs asks first; the edits are kept either way', async ({ page }) => {
    await openAndCompare(
      page,
      minimalDocx(['One two three.', 'Four five six.', 'Seven eight nine.', 'Ten eleven twelve.']),
      minimalDocx(['One 2 three.', 'Four five six.', 'Seven eight nine.', 'Ten eleven twelve.']),
    );
    const control = page.getByTestId('range-control');
    await startEditing(page);
    await cursorAtEnd(page, 'Seven');
    await page.keyboard.type(' ten');
    await expect(cards(page)).toHaveCount(2);

    await control.getByRole('button', { name: /Set an end point/ }).click();
    await control.getByLabel(/Compare the Original up to paragraph/).fill('2');
    await control.getByRole('button', { name: 'Apply' }).click();
    const rangeDialog = dialog(page, 'Move the end point?');
    await expect(rangeDialog).toContainText(
      'Your edits in 1 paragraph will be outside the comparison range. Their changes won’t be offered for decision, and the export keeps the Original’s text there.',
    );
    await rangeDialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(control).toContainText('Comparing the full documents.');
    await expect(cards(page)).toHaveCount(2);

    // Picking the paragraph in the left panel asks too.
    await control.getByRole('button', { name: /Set an end point/ }).click();
    await control.getByRole('button', { name: 'Pick in left panel' }).click();
    await page.getByTestId('panel-left').getByText('Four').click();
    await rangeDialog.getByRole('button', { name: 'Move the end point' }).click();
    await expect(control).toContainText('Comparing the Original up to paragraph 2.');
    await expect(cards(page)).toHaveCount(1);
    expect(await shown(page, 'right', 'Seven')).toBe('Seven eight nine. ten');

    // Back to the full documents (no edited paragraph left outside: no question): the change is offered again.
    await control.getByRole('button', { name: 'Compare the full documents' }).click();
    await expect(control).toContainText('Comparing the full documents.');
    await expect(cards(page)).toHaveCount(2);
  });
});

test.describe('three columns', () => {
  test.beforeEach(({ page }) => pinView(page, { ...TWO_COLUMNS, threeColumns: true }));

  test('an edit shows in the Resolved column too', async ({ page }) => {
    await openAndCompare(page, minimalDocx(['The quick brown fox.', 'Second paragraph.']), minimalDocx(['The quick red fox.', 'Second paragraph.']));
    await startEditing(page);
    await cursorAtEnd(page, 'Second paragraph.');
    await page.keyboard.type(' More');
    await expect(cards(page)).toHaveCount(2);
    await expect.poll(() => shown(page, 'resolved', 'Second paragraph.')).toBe('Second paragraph. More');
    expect(await shown(page, 'left', 'Second paragraph.')).toBe('Second paragraph.');
  });
});
