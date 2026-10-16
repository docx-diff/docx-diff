import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { engineVersion, initEngine, warmUp } from './docxodus';

// The app base URL is the folder holding `wasm/`; under Node that is the package's `dist/` folder.
const packageDistUrl = pathToFileURL(resolve(import.meta.dirname, '../../node_modules/docxodus/dist')).href + '/';

describe('docxodus wrapper', () => {
  it('initializes from <base>wasm/, warms up and reports the pinned version', async () => {
    await initEngine(packageDistUrl);
    warmUp();
    expect(engineVersion()).toEqual({ docxodus: '13.0.0', dotnet: expect.any(String) });
  });
});
