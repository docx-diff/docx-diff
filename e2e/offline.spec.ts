import { expect, test } from '@playwright/test';
import { minimalDocx } from '../test/minimal-docx';

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

test('a repeat visit loads the app and the engine from the service worker and works offline', async ({ page, context }) => {
  // Requests for engine files on the first visit, by the page (and its worker) and by the service worker.
  const engineRequests = { page: 0, serviceWorker: 0 };
  let pageRequestsBeforeServiceWorker: number | null = null;
  context.on('request', (request) => {
    if (!request.url().includes('/wasm/_framework/')) return;
    if (request.serviceWorker()) {
      pageRequestsBeforeServiceWorker ??= engineRequests.page;
      engineRequests.serviceWorker++;
    } else engineRequests.page++;
  });

  await page.goto('');
  await expect(page.getByRole('status')).toHaveText(/Engine ready/, { timeout: 60_000 });
  // Activation follows a complete precache; clientsClaim then gives the page a controller.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    }
  });
  const precache = await page.evaluate(async () => {
    let entries = 0;
    let bytes = 0;
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        entries++;
        bytes += (await (await cache.match(request))!.arrayBuffer()).byteLength;
      }
    }
    return { entries, megabytes: +(bytes / 1e6).toFixed(1) };
  });
  console.log('first visit: engine file requests', engineRequests, '; precache', precache);
  expect(precache.entries).toBeGreaterThanOrEqual(44);
  // The service worker is registered once the engine has loaded, so its precache doesn't compete with it.
  expect(pageRequestsBeforeServiceWorker).toBe(engineRequests.page);

  // Other pages on the origin (the org's other Pages sites, 404s) are left to the server.
  const elsewhere = await page.goto('other-site/');
  expect(elsewhere?.fromServiceWorker()).toBe(false);
  await page.goto('');

  await context.setOffline(true);
  const notFromServiceWorker: string[] = [];
  page.on('response', (response) => {
    if (!response.fromServiceWorker()) notFromServiceWorker.push(response.url());
  });
  await page.reload();
  await expect(page.getByRole('status')).toHaveText(/Engine ready/, { timeout: 60_000 });

  await page.getByLabel('Original document').setInputFiles({
    name: 'original.docx',
    mimeType: DOCX_TYPE,
    buffer: Buffer.from(minimalDocx(['The quick brown fox.'])),
  });
  await page.getByLabel('Edited document').setInputFiles({
    name: 'edited.docx',
    mimeType: DOCX_TYPE,
    buffer: Buffer.from(minimalDocx(['The quick red fox.'])),
  });
  await expect(page.getByTestId('panel-right').locator('ins.rev-ins', { hasText: 'red' })).toBeVisible({ timeout: 60_000 });
  expect(notFromServiceWorker.filter((url) => url.startsWith('http'))).toEqual([]);
});
