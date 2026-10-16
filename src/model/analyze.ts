// Main-thread step after a compare: index the rendered HTML, build the change items and propose
// the comparison range. Pure functions; the worker result is not modified.
import type { RevisionListEntry } from '../engine/types';
import { buildChangeItems, type ChangeItem } from './changes';
import { buildDocIndex, type DocIndex, type HtmlParser } from './docIndex';
import { detectTrailingRegion } from './range';

export interface Analysis {
  index: DocIndex;
  items: ChangeItem[];
  /** Proposed end of the comparison range (index in `index.bodyParagraphs`), or `null`. */
  suggestedEndPoint: number | null;
  /** Milliseconds spent. */
  timings: { index: number; items: number; range: number };
}

export function analyzeComparison(
  result: { revisions: readonly RevisionListEntry[]; html: string },
  parse?: HtmlParser,
): Analysis {
  let start = performance.now();
  const index = buildDocIndex(result.html, parse);
  const indexMs = performance.now() - start;

  start = performance.now();
  const items = buildChangeItems(result.revisions, index);
  const itemsMs = performance.now() - start;

  start = performance.now();
  const suggestedEndPoint = detectTrailingRegion(items, index);
  const rangeMs = performance.now() - start;

  return {
    index,
    items,
    suggestedEndPoint,
    timings: { index: Math.round(indexMs), items: Math.round(itemsMs), range: Math.round(rangeMs) },
  };
}
