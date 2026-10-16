// Thin wrapper over `docxodus/core`. This is the only module that imports `docxodus`.
import { getVersion, getWasmExports, initialize } from 'docxodus/core';
import type { EngineVersion } from './types';

/** Loads the engine runtime from `<appBaseUrl>wasm/_framework/`. */
export async function initEngine(appBaseUrl: string): Promise<void> {
  await initialize(new URL('wasm/', appBaseUrl).href);
}

/** Runs the engine's comparer once on built-in input so the first real comparison isn't slowed down. */
export function warmUp(): void {
  const result = getWasmExports().DocumentComparer.Warmup();
  if (result !== 'ok') {
    throw new Error(`Engine warm-up failed: ${result}`);
  }
}

export function engineVersion(): EngineVersion {
  return { docxodus: __DOCXODUS_VERSION__, dotnet: getVersion().dotnetVersion };
}
