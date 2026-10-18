// The compare pipeline the worker runs: normalize and check the inputs, read their headings and
// the Edited's author, compare, list revisions, tag and render, and find the paragraphs inline
// edits can't change.
// Kept apart from the worker so that Node tests run exactly the same steps.
import { unpatchableParagraphs } from './applyEdits';
import { documentAuthor } from './author';
import { compare, listRevisions, render } from './docxodus';
import { documentHeadings } from './headings';
import { normalizeDocxText } from './normalizeText';
import { tagRedline } from './tagRedline';
import type { CompareResult, ProgressStage, RevisionListEntry } from './types';

export interface ComparePipelineResult extends Omit<CompareResult, 'redline'> {
  redline: Uint8Array;
}

export async function runCompare(
  original: Uint8Array,
  edited: Uint8Array,
  onStage: (stage: ProgressStage) => void = () => {},
): Promise<ComparePipelineResult> {
  const timings = { normalize: 0, checkInputs: 0, headings: 0, author: 0, compare: 0, list: 0, tag: 0, render: 0, editable: 0 };
  const timed = async <T>(name: keyof typeof timings, step: () => T | Promise<T>): Promise<T> => {
    const start = performance.now();
    try {
      return await step();
    } finally {
      timings[name] = Math.round(performance.now() - start);
    }
  };

  onStage('comparing');
  [original, edited] = await timed('normalize', () => [normalizeDocxText(original), normalizeDocxText(edited)]);
  const inputsHadRevisions = await timed('checkInputs', async () => {
    const [originalRevisions, editedRevisions] = [await listRevisions(original), await listRevisions(edited)];
    return originalRevisions.length > 0 || editedRevisions.length > 0;
  });
  const headings = await timed('headings', () => ({ original: documentHeadings(original), edited: documentHeadings(edited) }));
  const editedAuthor = await timed('author', () => documentAuthor(edited));
  const redline = await timed('compare', () => compare(original, edited));

  onStage('listing');
  const revisions: RevisionListEntry[] = await timed('list', () => listRevisions(redline));

  onStage('rendering');
  const tagged = await timed('tag', () => tagRedline(redline, revisions));
  if (tagged.missingKeys.length > 0) {
    console.warn(`Revision markup not found while tagging: ${tagged.missingKeys.length} keys`, tagged.missingKeys.slice(0, 5));
  }
  const html = await timed('render', () => render(tagged.bytes));
  const uneditableBlocks = await timed('editable', () => unpatchableParagraphs(redline));

  return { redline, revisions, html, uneditableBlocks, inputsHadRevisions, editedAuthor, headings, timings };
}
