// Random keys in the Edited panel while Editable is on, checked against the same keys in a plain
// editable box: the text the reviewer sees must end up the same, whatever the markup around it
// (insertions, hidden deletions, the updates rewriting the paragraph 300 ms after the last input).
// Pauses around that delay put keys before, during and after updates. This found the revert icons
// trapping the cursor in the text (docs/architecture.md, "Inline edits", "Reverts").
import { expect, test, type Page } from '@playwright/test';
import { minimalDocx } from '../test/minimal-docx';
import { TWO_COLUMNS, pinView } from './viewSettings';

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const SEEDS = 12;
const STEPS = 18;
const KEYS = ['ArrowLeft', 'ArrowRight', 'Backspace', 'Backspace', 'Delete', 'Control+Backspace', 'Control+Delete', 'type:x', 'type: ', 'type:é', 'type:ab '];
const PAUSES = [0, 0, 30, 150, 280, 320, 700];

test.beforeEach(({ page }) => pinView(page, TWO_COLUMNS));

const paragraph = (page: Page) => page.getByTestId('panel-right').locator('p').first();

/** The text the Edited panel shows in the paragraph (no deletions), no-break spaces as spaces. */
const shownText = (page: Page) =>
  paragraph(page).evaluate((block) => {
    let text = '';
    const walker = block.ownerDocument.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) if (!node.parentElement!.closest('del, .edit-revert')) text += node.textContent;
    return text.replace(/ /g, ' ');
  });

/** Puts the cursor at an offset of the shown text, as a click there would. */
const caretAt = (page: Page, offset: number) =>
  paragraph(page).evaluate((block, offset) => {
    (block as HTMLElement).focus();
    const walker = block.ownerDocument.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let left = offset;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentElement!.closest('del, .edit-revert')) continue;
      if (left <= node.textContent!.length) {
        block.ownerDocument.getSelection()!.setBaseAndExtent(node, left, node, left);
        return;
      }
      left -= node.textContent!.length;
    }
  }, offset);

const press = async (page: Page, key: string) => {
  if (key.startsWith('type:')) await page.keyboard.type(key.slice(5));
  else await page.keyboard.press(key);
};

/** A small deterministic random number generator. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

test('random keys in an editable paragraph leave the same text as in a plain editable box', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('');
  await expect(page.getByRole('status').filter({ hasText: /Engine/ })).toHaveText(/Engine ready/, { timeout: 60_000 });
  const docx = (paragraphs: string[]) => ({ mimeType: DOCX_TYPE, buffer: Buffer.from(minimalDocx(paragraphs)) });
  await page.getByLabel('Original document').setInputFiles({ name: 'o.docx', ...docx(['Elvitte az alamizsnás szilke tartalmát.', 'Más.']) });
  await page.getByLabel('Edited document').setInputFiles({ name: 'e.docx', ...docx(['Elvitte az alamizsnás szilke tartalmát.', 'Más bekezdés.']) });
  await expect(page.getByTestId('panel-right')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Editable' }).click();

  const failures: string[] = [];
  for (let seed = 1; seed <= SEEDS; seed++) {
    const next = random(seed);
    const pick = <T,>(list: readonly T[]) => list[Math.floor(next() * list.length)]!;
    const revertAll = page.getByRole('button', { name: 'Revert all my edits' });
    if (await revertAll.isEnabled()) {
      await revertAll.click();
      await page.getByRole('dialog').getByRole('button', { name: 'Revert all' }).click();
    }
    const start = await shownText(page);
    const at = Math.floor(next() * start.length);
    await caretAt(page, at);
    const keys: string[] = [];
    const shown: string[] = [];
    for (let i = 0; i < STEPS; i++) {
      const key = pick(KEYS);
      const pause = pick(PAUSES);
      keys.push(`${key}~${pause}`);
      await press(page, key);
      if (pause) await page.waitForTimeout(pause);
      shown.push(await shownText(page));
    }
    await page.waitForTimeout(700);
    const result = await shownText(page);

    // The same keys in a plain editable box (no pauses: nothing happens between keys there).
    await page.evaluate(({ start, at }) => {
      const box = document.createElement('div');
      box.id = 'fuzz-reference';
      box.contentEditable = 'true';
      box.style.whiteSpace = 'pre-wrap';
      box.textContent = start;
      document.body.append(box);
      box.focus();
      document.getSelection()!.setBaseAndExtent(box.firstChild!, at, box.firstChild!, at);
    }, { start, at });
    const expected: string[] = [];
    for (const entry of keys) {
      await press(page, entry.split('~')[0]!);
      expected.push(await page.evaluate(() => document.getElementById('fuzz-reference')!.textContent!.replace(/ /g, ' ')));
    }
    await page.evaluate(() => document.getElementById('fuzz-reference')!.remove());

    if (result !== expected.at(-1)) {
      const first = shown.findIndex((text, i) => text !== expected[i]);
      failures.push(
        `seed ${seed}, cursor at ${at} in ${JSON.stringify(start)}: ${keys.join(' ')}\n` +
          `  first difference after key ${first + 1} (${keys[first]}): ${JSON.stringify(shown[first])}, expected ${JSON.stringify(expected[first])}\n` +
          `  at the end: ${JSON.stringify(result)}, expected ${JSON.stringify(expected.at(-1))}`,
      );
    }
  }
  expect(failures, failures.join('\n')).toEqual([]);
});
