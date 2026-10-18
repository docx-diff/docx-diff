import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { minimalDocx } from '../test/minimal-docx';
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

    // The paragraph with an inserted mark can't be edited.
    await paragraph(page, 'right', 'Added.').click();
    await expect(toast(page)).toHaveText(/can’t be edited here/);
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
    await expect(cards(page)).toHaveCount(3);
    expect(await shown(page, 'right', 'Second paragraph.')).toBe('Second paragraph. Aa Bb');

    // Two places in one paragraph within the update's delay: both edits are kept.
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' Cc');
    await page.keyboard.press('Control+Home');
    await page.keyboard.type('Dd ');
    await expect.poll(() => shown(page, 'right', 'fox.')).toBe('Dd The quick red fox. Cc');
    await expect(cards(page)).toHaveCount(5);
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
