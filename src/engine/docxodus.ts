// Thin wrapper over `docxodus/core`. This is the only module that imports `docxodus`.
import {
  convertDocxToHtml,
  docxDiffCompare,
  getRevisions,
  getVersion,
  getWasmExports,
  initialize,
} from 'docxodus/core';
import { COMPARE_SETTINGS } from './settings';
import type { EngineVersion, RevisionListEntry } from './types';

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

/** Compares two documents with the app's settings; returns the redline `.docx` with native tracked changes. */
export function compare(original: Uint8Array, edited: Uint8Array): Promise<Uint8Array> {
  return docxDiffCompare(original, edited, COMPARE_SETTINGS);
}

/** Lists the tracked revisions of a document, in document order per part. */
export async function listRevisions(document: Uint8Array): Promise<RevisionListEntry[]> {
  return getRevisions(document);
}

/** Renders a redline to HTML with tracked changes, notes, moves and block anchors (`data-anchor`). */
export function render(redline: Uint8Array): Promise<string> {
  return convertDocxToHtml(redline, {
    renderTrackedChanges: true,
    renderFootnotesAndEndnotes: true,
    renderMoveOperations: true,
    stampAnchors: true,
  });
}
