import { readFile } from 'node:fs/promises';
import { expect, type Page } from '@playwright/test';

const UNDECIDED_OPTIONS = {
  accept: /Accept undecided changes/,
  reject: /Reject undecided changes/,
  track: /Keep undecided changes as tracked changes/,
};

/**
 * Opens the export dialog from the toolbar, picks how undecided changes are treated (and the
 * author, if given), clicks its Download, and returns the downloaded file's name and bytes once the
 * dialog has closed.
 */
export async function downloadReviewed(
  page: Page,
  undecided: keyof typeof UNDECIDED_OPTIONS = 'accept',
  author?: string,
): Promise<{ name: string; bytes: Uint8Array }> {
  await page.getByRole('toolbar').getByRole('button', { name: 'Download…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Download the reviewed document' });
  await expect(dialog).toBeVisible();
  const option = dialog.getByLabel(UNDECIDED_OPTIONS[undecided]);
  if (await option.isEnabled()) await option.check();
  if (author !== undefined) await dialog.getByLabel('Author of the comments and tracked changes').fill(author);
  const [file] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), dialog.getByRole('button', { name: 'Download', exact: true }).click()]);
  await expect(dialog).toBeHidden();
  return { name: file.suggestedFilename(), bytes: new Uint8Array(await readFile((await file.path())!)) };
}
