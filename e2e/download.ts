import { readFile } from 'node:fs/promises';
import { expect, type Page } from '@playwright/test';

/**
 * Opens the export dialog from the toolbar, picks how undecided changes are treated, clicks its
 * Download, and returns the downloaded file's name and bytes once the dialog has closed.
 */
export async function downloadReviewed(page: Page, undecided: 'accept' | 'reject' = 'accept'): Promise<{ name: string; bytes: Uint8Array }> {
  await page.getByRole('toolbar').getByRole('button', { name: 'Download…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Download the reviewed document' });
  await expect(dialog).toBeVisible();
  const option = dialog.getByLabel(undecided === 'accept' ? /Accept undecided changes/ : /Reject undecided changes/);
  if (await option.isEnabled()) await option.check();
  const [file] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), dialog.getByRole('button', { name: 'Download', exact: true }).click()]);
  await expect(dialog).toBeHidden();
  return { name: file.suggestedFilename(), bytes: new Uint8Array(await readFile((await file.path())!)) };
}
