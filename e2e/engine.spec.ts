import { expect, test, type Page } from '@playwright/test';
import { minimalDocx } from '../test/minimal-docx';
import { readSamples, samplesAvailable } from '../test/samples';

test('loads the engine from the base path, with no requests to other sites', async ({ page, baseURL }) => {
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

test('shows a loading modal until the engine is ready', async ({ page }) => {
  // Slow down the largest engine file so the modal is on screen long enough to check.
  await page.route('**/dotnet.native.wasm', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  await page.goto('');
  const modal = page.getByRole('dialog', { name: 'Loading' });
  await expect(modal).toBeVisible();
  await expect(modal).toContainText(/Loading…/);
  await expect(modal).toContainText(/comparison engine… \d+\.\d s/);
  await expect(page.getByRole('status')).toHaveText(/Engine ready/, { timeout: 60_000 });
  await expect(modal).toBeHidden();
});

/** Runs `init` + `compare` in a fresh copy of the app's engine worker and summarizes the result. */
async function compareInWorker(page: Page, workerUrl: string, original: Uint8Array, edited: Uint8Array) {
  return page.evaluate(
    async ({ workerUrl, original, edited }) => {
      const worker = new Worker(workerUrl, { type: 'module' });
      let nextId = 1;
      const request = (type: string, payload: unknown, transfer: Transferable[] = []) =>
        new Promise<any>((resolve, reject) => {
          const id = nextId++;
          worker.addEventListener('message', function listener(event) {
            if (event.data.id !== id) return;
            worker.removeEventListener('message', listener);
            if (event.data.ok) resolve(event.data.result);
            else reject(new Error(event.data.error.message));
          });
          worker.postMessage({ id, type, payload }, transfer);
        });
      const stages: string[] = [];
      worker.addEventListener('message', (event) => {
        if (event.data.type === 'progress') stages.push(event.data.stage);
      });
      await request('init', { appBaseUrl: new URL('.', location.href).href });
      stages.length = 0;
      const originalBuffer = new Uint8Array(original).buffer;
      const editedBuffer = new Uint8Array(edited).buffer;
      const start = performance.now();
      const result = await request('compare', { original: originalBuffer, edited: editedBuffer }, [originalBuffer, editedBuffer]);
      const elapsed = Math.round(performance.now() - start);
      worker.terminate();
      return {
        elapsed,
        stages,
        transferred: originalBuffer.byteLength === 0,
        redlineIsBuffer: result.redline instanceof ArrayBuffer && result.redline.byteLength > 0,
        revisions: result.revisions.length,
        texts: result.revisions.map((r: { text: string }) => r.text),
        taggedElements: (result.html.match(/data-author="rev:/g) ?? []).length,
        inputsHadRevisions: result.inputsHadRevisions,
        timings: result.timings,
      };
    },
    { workerUrl, original: [...original], edited: [...edited] },
  );
}

test('compares two documents in the engine worker', async ({ page }) => {
  const workerUrl = new Promise<string>((resolve) => page.on('worker', (worker) => resolve(worker.url())));
  await page.goto('');
  await expect(page.getByRole('status')).toHaveText(/Engine ready/, { timeout: 60_000 });

  const small = await compareInWorker(
    page,
    await workerUrl,
    minimalDocx(['The quick brown fox.', 'Second paragraph.']),
    minimalDocx(['The quick red fox.', 'Second paragraph.']),
  );
  expect(small).toMatchObject({ transferred: true, redlineIsBuffer: true, inputsHadRevisions: false });
  expect(small.stages).toEqual(['comparing', 'listing', 'rendering']);
  expect(small.texts).toEqual(expect.arrayContaining(['brown', 'red']));
  expect(small.taggedElements).toBeGreaterThanOrEqual(2);

  if (samplesAvailable) {
    const { original, edited } = readSamples();
    const sample = await compareInWorker(page, await workerUrl, original, edited);
    console.log(`sample pair in Chromium: ${sample.elapsed} ms`, sample.timings);
    expect(sample.revisions).toBe(796);
  }
});
