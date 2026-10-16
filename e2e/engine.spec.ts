import { expect, test } from '@playwright/test';

test('loads the engine from the app subpath, with no requests to other sites', async ({ page, baseURL }) => {
  const { origin, pathname: basePath } = new URL(baseURL!);
  const foreignRequests: string[] = [];
  const engineFiles: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.protocol.startsWith('http') && url.origin !== origin) foreignRequests.push(request.url());
    if (url.pathname.includes('/wasm/_framework/')) engineFiles.push(url.pathname);
  });

  await page.goto('');
  await expect(page.getByRole('status')).toHaveText(/Engine ready · Docxodus 13\.0\.0/, { timeout: 60_000 });

  expect(foreignRequests).toEqual([]);
  expect(engineFiles.length).toBeGreaterThan(0);
  expect(engineFiles.every((path) => path.startsWith(`${basePath}wasm/_framework/`))).toBe(true);
});
