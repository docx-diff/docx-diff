import { expect, test, type Page } from '@playwright/test';
import { minimalDocx } from '../test/minimal-docx';
import { docxText } from '../test/text';
import { downloadReviewed } from './download';

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const ORIGINAL = minimalDocx(['One two three.', 'Four five six.', 'Seven eight nine.', 'Ten eleven twelve.']);
const EDITED = minimalDocx(['One 2 three.', 'Four five six. Added.', 'Ten 11 twelve.', 'A new ending.']);

async function openAndCompare(page: Page, original = ORIGINAL, edited = EDITED) {
  await page.goto('');
  await expect(page.getByRole('status')).toHaveText(/Engine ready/, { timeout: 60_000 });
  await page.getByLabel('Original document').setInputFiles({ name: 'original.docx', mimeType: DOCX_TYPE, buffer: Buffer.from(original) });
  await page.getByLabel('Edited document').setInputFiles({ name: 'edited.docx', mimeType: DOCX_TYPE, buffer: Buffer.from(edited) });
  await expect(page.getByTestId('panel-right').locator('[data-change-id]').first()).toBeAttached({ timeout: 60_000 });
}

/** The Resolved column's text as shown: one line per paragraph, whitespace-normalised, no empty lines. */
async function resolvedText(page: Page): Promise<string[]> {
  const text = await page.getByTestId('panel-resolved').locator('.doc').innerText();
  return text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line !== '');
}

const panels = (page: Page) => page.locator('[data-testid^="panel-"]');

test('a fresh browser shows three columns with both sidebars collapsed', async ({ page }) => {
  await openAndCompare(page);
  await expect(panels(page)).toHaveCount(3);
  const order = await panels(page).evaluateAll((elements) => elements.map((element) => element.getAttribute('data-testid')));
  expect(order).toEqual(['panel-left', 'panel-resolved', 'panel-right']);
  await expect(page.getByRole('region', { name: 'Resolved' }).getByRole('heading')).toHaveAttribute('title', /formatting as in the Edited document/);
  await expect(page.getByTitle('Show the outline')).toBeVisible();
  await expect(page.getByRole('button', { name: /Changes · \d+ undecided/ })).toBeVisible();
  // Undecided changes show as accepted.
  expect(await resolvedText(page)).toEqual(['One 2 three.', 'Four five six. Added.', 'Ten 11 twelve.', 'A new ending.']);
});

test('the top bar button switches between two and three columns, remembered after a reload', async ({ page }) => {
  await openAndCompare(page);
  const toggle = page.getByRole('button', { name: 'Show two columns' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await toggle.click();
  await expect(panels(page)).toHaveCount(2);
  await expect(page.getByTestId('panel-resolved')).toHaveCount(0);

  await page.reload();
  await page.getByRole('dialog', { name: /Resume review/ }).getByRole('button', { name: 'Resume' }).click();
  await expect(page.getByTestId('panel-right').locator('ins').first()).toBeAttached({ timeout: 60_000 });
  await expect(panels(page)).toHaveCount(2);
  const back = page.getByRole('button', { name: 'Show three columns' });
  await expect(back).toHaveAttribute('aria-pressed', 'false');
  await back.click();
  await expect(panels(page)).toHaveCount(3);
  expect(await resolvedText(page)).toEqual(['One 2 three.', 'Four five six. Added.', 'Ten 11 twelve.', 'A new ending.']);
});

test('a window 1024 px wide or narrower shows two columns, with the button disabled', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await openAndCompare(page);
  await expect(panels(page)).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'The window is too narrow for three columns' })).toBeDisabled();

  await page.setViewportSize({ width: 1100, height: 768 });
  await expect(panels(page)).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Show two columns' })).toBeEnabled();
});

test("the Resolved column's text is the downloaded document's text after deciding changes", async ({ page }) => {
  await openAndCompare(page);
  await page.getByRole('button', { name: /Changes · \d+ undecided/ }).click();
  // Reject the first change and the third, accept the second; the rest stay undecided.
  await page.keyboard.press('j');
  await page.keyboard.press('r');
  await page.keyboard.press('a');
  await page.keyboard.press('r');
  await expect(page.getByTestId('changes-totals')).toContainText('1 accepted, 2 rejected, 2 undecided');
  const shown = await resolvedText(page);
  expect(shown).toContain('One two three.');
  expect(shown).toEqual(docxText((await downloadReviewed(page, 'accept')).bytes));

  // Reject all undecided: the Original's text except for the accepted insertion.
  await page.getByRole('button', { name: 'Reject all' }).click();
  await page.getByRole('dialog', { name: 'Reject all changes?' }).getByRole('button', { name: 'Reject all' }).click();
  await expect.poll(() => resolvedText(page)).toEqual(['One two three.', 'Four five six. Added.', 'Seven eight nine.', 'Ten eleven twelve.']);
});

test('clicking a change in the Resolved column selects it', async ({ page }) => {
  await openAndCompare(page);
  await page.getByTestId('panel-resolved').locator('ins', { hasText: 'Added.' }).click();
  // The card stays in the Edited's panel.
  await expect(page.getByTestId('panel-right').getByTestId('inline-change-card')).toContainText('Added.');
  await expect(page.getByTestId('panel-resolved').locator('ins.change-current', { hasText: 'Added.' })).toBeVisible();
});

test('the three columns scroll together, and the next change is revealed in each', async ({ page }) => {
  const paragraphs = Array.from({ length: 120 }, (_, i) => `Paragraph number ${i + 1} of the document.`);
  const edited = paragraphs.map((text, i) => (i === 100 ? text.replace('number', 'No.') : text));
  await openAndCompare(page, minimalDocx(paragraphs), minimalDocx(edited));
  const scrollTop = (side: string) => page.getByTestId(`panel-${side}`).evaluate((element) => element.scrollTop);

  await page.getByTestId('panel-resolved').evaluate((element) => (element.scrollTop = 1000));
  await expect.poll(() => scrollTop('left')).toBeGreaterThan(900);
  await expect.poll(() => scrollTop('right')).toBeGreaterThan(900);

  await page.getByTestId('panel-left').evaluate((element) => (element.scrollTop = 0));
  await expect.poll(() => scrollTop('resolved')).toBe(0);
  await page.keyboard.press('j');
  for (const side of ['left', 'resolved', 'right']) {
    await expect(page.getByTestId(`panel-${side}`).locator('[data-change-id]').filter({ visible: true }).first()).toBeInViewport();
  }
});

test('text appearing above the top of the Resolved column does not move the text being read', async ({ page }) => {
  const paragraphs = Array.from({ length: 120 }, (_, i) => `Paragraph number ${i + 1} of the document.`);
  // Paragraphs 3–8 deleted: hidden in the Resolved column until rejected.
  await openAndCompare(page, minimalDocx(paragraphs), minimalDocx(paragraphs.filter((_, i) => i < 2 || i > 7)));
  // The list open first (it narrows the columns), and the scroll lock off (the scroll sync would
  // realign the column with the others).
  await page.getByRole('button', { name: /Changes · \d+ undecided/ }).click();
  await page.getByRole('button', { name: /Scroll lock/ }).click();
  const middle = page.getByTestId('panel-resolved');
  // Chromium's own scroll anchoring would do it; the column must also work in browsers without it.
  await middle.evaluate((element) => {
    element.style.overflowAnchor = 'none';
    element.scrollTop = 1500;
  });
  /** The text of the first paragraph at the top of the column, and its distance from the top. */
  const top = () =>
    middle.evaluate((scroller) => {
      const origin = scroller.getBoundingClientRect().top;
      for (const block of scroller.shadowRoot!.querySelectorAll('[data-anchor]')) {
        const box = block.getBoundingClientRect();
        if (box.height > 0 && box.bottom > origin) return { text: block.textContent, offset: Math.round(box.top - origin) };
      }
      return null;
    });
  const before = await top();
  expect(before?.text).toMatch(/Paragraph number/);

  await page.getByRole('button', { name: 'Reject all' }).click();
  await page.getByRole('dialog', { name: 'Reject all changes?' }).getByRole('button', { name: 'Reject all' }).click();
  await expect.poll(() => middle.locator('del').first().isVisible()).toBe(true);
  expect(await top()).toEqual(before);
});

test('with a comparison range, the Resolved column shows the Original after the divider, as the export does', async ({ page }) => {
  // The Edited document stops after the third paragraph: the rest is outside the detected range.
  const original = minimalDocx(['One two three.', 'Four five six.', 'Seven eight nine.', 'Ten eleven twelve.', 'Thirteen.']);
  const edited = minimalDocx(['One 2 three.', 'Four 5 six.', 'Seven 8 nine.']);
  await openAndCompare(page, original, edited);
  const middle = page.getByTestId('panel-resolved');
  await expect(middle.locator('.range-divider')).toBeVisible();
  const shown = await resolvedText(page);
  expect(shown).toEqual(['One 2 three.', 'Four 5 six.', 'Seven 8 nine.', 'End of the comparison · the rest is treated as unedited', 'Ten eleven twelve.', 'Thirteen.']);
  expect(shown.filter((line) => !line.startsWith('End of the comparison'))).toEqual(docxText((await downloadReviewed(page, 'accept')).bytes));
});

test("the collapsed sidebars' labels sit at the top of their strips", async ({ page }) => {
  await openAndCompare(page);
  for (const show of [page.getByTitle('Show the outline'), page.getByTitle('Show the changes list')]) {
    const strip = (await show.boundingBox())!;
    const label = await show.evaluate((button) => {
      const range = document.createRange();
      range.selectNodeContents(button);
      return range.getBoundingClientRect().top - button.getBoundingClientRect().top;
    });
    expect(strip.height).toBeGreaterThan(300);
    expect(label).toBeLessThan(20);
  }
});

/** An element's background colour, and the content of its `::after` (the ✓/✗). */
const marks = (element: Element) => ({
  background: getComputedStyle(element).backgroundColor,
  after: getComputedStyle(element, '::after').content,
  decoration: getComputedStyle(element).textDecorationStyle,
});

const YELLOW = 'rgb(255, 248, 197)';
const NONE = 'rgba(0, 0, 0, 0)';

test('decided changes are yellow in the Resolved column, with ✓ or ✗; undecided ones are dotted', async ({ page }) => {
  await openAndCompare(page);
  const middle = page.getByTestId('panel-resolved');
  await page.getByRole('button', { name: /Changes · \d+ undecided/ }).click();
  // Accept the replacement (two → 2), reject the insertion ("Added.").
  await page.keyboard.press('j');
  await page.keyboard.press('a');
  await page.keyboard.press('r');
  await expect(page.getByTestId('changes-totals')).toContainText('1 accepted, 1 rejected, 3 undecided');

  const accepted = middle.locator('ins.change-accepted', { hasText: '2' });
  expect(await accepted.evaluate(marks)).toMatchObject({ background: YELLOW, after: '"✓"' });
  // The rejected insertion leaves no text: its marker shows the ✗.
  await expect(middle.locator('ins', { hasText: 'Added.' })).toBeHidden();
  const marker = middle.locator('.resolved-marker.change-rejected');
  await expect(marker).toBeVisible();
  expect(await marker.evaluate(marks)).toMatchObject({ background: YELLOW, after: '"✗"' });
  // Undecided: no yellow, no icon, a dotted underline.
  expect(await middle.locator('ins', { hasText: '11' }).evaluate(marks)).toEqual({ background: NONE, after: 'none', decoration: 'dotted' });
  // The side panels keep their marks.
  expect(await page.getByTestId('panel-right').locator('ins.change-accepted', { hasText: '2' }).evaluate((element) => getComputedStyle(element).opacity)).toBe('0.5');
});

test('a deletion leaves a marker in the Resolved column that selects it when clicked', async ({ page }) => {
  await openAndCompare(page);
  const middle = page.getByTestId('panel-resolved');
  // The deleted paragraph is undecided (shown as accepted): a dotted placeholder where it was.
  await expect(middle.getByText('Seven eight nine.')).toBeHidden();
  const marker = middle.locator('.resolved-marker--shown');
  await expect(marker).toHaveCount(1);
  expect(await marker.evaluate(marks)).toMatchObject({ background: NONE, after: '""' });
  await marker.click();
  await expect(marker).toHaveClass(/change-current/);
  await expect(page.getByTestId('panel-right').getByTestId('inline-change-card')).toContainText('Seven eight nine.');
  await page.keyboard.press('a');
  expect(await marker.evaluate(marks)).toMatchObject({ background: YELLOW, after: '"✓"' });
});

test('the legend shows the Resolved column marks only in three-column view', async ({ page }) => {
  await openAndCompare(page);
  const help = page.getByRole('button', { name: 'Help' });
  const legend = page.getByRole('list', { name: 'Legend' });
  await help.click();
  await expect(legend.getByText('Decided', { exact: true })).toBeVisible();
  await expect(legend.getByText('Undecided')).toBeVisible();
  await expect(legend.getByRole('listitem').filter({ hasText: /^Decided$/ })).toHaveAttribute('title', 'In the Resolved column');
  await help.click();
  await page.getByRole('button', { name: 'Show two columns' }).click();
  await help.click();
  await expect(legend.getByText('Deleted')).toBeVisible();
  await expect(legend.getByText('Decided', { exact: true })).toHaveCount(0);
});
