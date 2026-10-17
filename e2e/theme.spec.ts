import { expect, test } from '@playwright/test';
import { TWO_COLUMNS, pinView } from './viewSettings';

// The view these tests were written for (the three-column view has its own tests in resolved.spec.ts).
test.beforeEach(({ page }) => pinView(page, TWO_COLUMNS));

test("follows the browser's dark preference, and the top bar's button switches it", async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('');
  const root = page.locator('html');
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await expect(root).toHaveCSS('background-color', 'rgb(13, 17, 23)');

  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await expect(root).toHaveAttribute('data-theme', 'light');
  await expect(root).toHaveCSS('background-color', 'rgb(255, 255, 255)');

  // The choice is remembered, and applied before the app has loaded.
  await page.reload();
  await expect(root).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await expect(root).toHaveAttribute('data-theme', 'dark');
});
