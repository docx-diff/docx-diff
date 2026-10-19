import { expect, type Locator, type Page } from '@playwright/test';

/** The toolbar's Range button, which opens the comparison range dialog. */
export const rangeButton = (page: Page): Locator => page.getByRole('toolbar').getByRole('button', { name: /Range/ });

/** Opens the comparison range dialog. */
export async function openRange(page: Page): Promise<Locator> {
  await rangeButton(page).click();
  const dialog = page.getByRole('dialog', { name: 'Comparison range' });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Checks the range dialog's text, then closes it. */
export async function expectRange(page: Page, text: string | RegExp): Promise<void> {
  const dialog = await openRange(page);
  await expect(dialog).toContainText(text);
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
}

/** Compares the full documents (from the detected or a chosen end point). */
export async function compareFull(page: Page): Promise<void> {
  const dialog = await openRange(page);
  await dialog.getByRole('button', { name: 'Compare the full documents' }).click();
  await expect(dialog).toBeHidden();
}
