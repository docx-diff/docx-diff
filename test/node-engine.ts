// Initializes the real Docxodus WASM engine under Node, for engine tests.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as docxodus from 'docxodus/core';

/** `file://` URL of the package's `dist/wasm/` folder (with a trailing slash, as `initialize` expects). */
export function wasmBaseUrl(): string {
  return pathToFileURL(resolve(import.meta.dirname, '../node_modules/docxodus/dist/wasm')).href + '/';
}

/** Initializes the engine (once per test file) and returns the `docxodus/core` module. */
export async function initNodeEngine(): Promise<typeof docxodus> {
  await docxodus.initialize(wasmBaseUrl());
  return docxodus;
}
