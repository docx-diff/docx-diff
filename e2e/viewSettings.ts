import type { Page } from '@playwright/test';

/** The view settings stored in the browser (`src/ui/useViewSettings.ts`). */
export interface ViewSettings {
  inlineCard: boolean;
  changesList: boolean;
  outline: boolean;
  threeColumns: boolean;
}

/** The view before the Resolved column: two columns, both sidebars shown. */
export const TWO_COLUMNS: Partial<ViewSettings> = { changesList: true, outline: true, threeColumns: false };

/**
 * Stores view settings before the app loads. Only when none are stored: the script runs on every
 * navigation, and a setting the test changes must survive a reload.
 */
export async function pinView(page: Page, settings: Partial<ViewSettings>): Promise<void> {
  await page.addInitScript((settings) => {
    const key = 'docx-diff:view-settings';
    if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify(settings));
  }, settings);
}
