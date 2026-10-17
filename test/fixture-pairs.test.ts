// Rendering checks on every synthetic fixture pair (docs/architecture.md): every content, move and
// paragraph-mark revision is in the HTML with its id, and every item has an element in the
// panels; and item-level export checks on the notes. Export round trips per revision are in
// src/engine/exportDocx.test.ts.
import { readFileSync } from 'node:fs';
import { DOMParser } from '@xmldom/xmldom';
import { strFromU8, unzipSync } from 'fflate';
import { JSDOM } from 'jsdom';
import { beforeAll, describe, expect, it } from 'vitest';
import { exportDocx } from '../src/engine/exportDocx';
import { W_NS } from '../src/engine/ooxml';
import { runCompare, type ComparePipelineResult } from '../src/engine/pipeline';
import { analyzeComparison, type Analysis } from '../src/model/analyze';
import { finalRevisionDecisions, reviewableItems } from '../src/model/decisions';
import { DEFAULT_COMPARE_SETTINGS, ignoredItems } from '../src/model/equivalence';
import { blockPositions, classify } from '../src/model/range';
import { resolvedItemDecisions } from '../src/model/resolved';
import { decorateDocument, parseRenderedHtml, prepareRenderedDocument } from '../src/ui/renderedDocument';
import { applyRangeOrder, applyResolution, prepareResolvedPanel, resolvedText } from '../src/ui/resolvedView';
import { FIXTURES, FIXTURES_DIR } from './fixtures/make-fixtures';
import { initNodeEngine } from './node-engine';
import { parityStates } from './parity';
import { docxText } from './text';

const parse = (html: string) => new JSDOM(html).window.document;

beforeAll(async () => {
  await initNodeEngine();
});

/**
 * Notes of an exported document that are not referenced exactly once from the body, or that have
 * no text (separators aside), e.g. `footnote 2: 0 references`.
 */
function noteProblems(exported: Uint8Array): string[] {
  const files = unzipSync(exported);
  const parse = (path: string) => (files[path] ? new DOMParser().parseFromString(strFromU8(files[path]), 'text/xml') : undefined);
  const body = parse('word/document.xml')!;
  const problems: string[] = [];
  for (const [kind, reference] of [['footnote', 'footnoteReference'], ['endnote', 'endnoteReference']] as const) {
    const notes = parse(`word/${kind}s.xml`);
    if (!notes) continue;
    const references = [...body.getElementsByTagNameNS(W_NS, reference)].map((element) => element.getAttributeNS(W_NS, 'id'));
    for (const note of [...notes.getElementsByTagNameNS(W_NS, kind)]) {
      if (note.hasAttributeNS(W_NS, 'type')) continue;
      const id = note.getAttributeNS(W_NS, 'id');
      const count = references.filter((referenceId) => referenceId === id).length;
      if (count !== 1) problems.push(`${kind} ${id}: ${count} references`);
      if (!note.textContent?.trim()) problems.push(`${kind} ${id}: no text`);
    }
  }
  return problems;
}

describe.each(FIXTURES.map((fixture) => fixture.name))('fixture %s', (name) => {
  let result: ComparePipelineResult;
  let analysis: Analysis;

  beforeAll(async () => {
    const read = (side: string) => new Uint8Array(readFileSync(`${FIXTURES_DIR}/${name}.${side}.docx`));
    result = await runCompare(read('original'), read('edited'));
    analysis = analyzeComparison(result, parse);
  });

  it('puts every revision in exactly one item', () => {
    const ids = analysis.items.flatMap((item) => item.revisionIds);
    expect([...ids].sort()).toEqual(result.revisions.map((revision) => revision.id).sort());
  });

  it('shows every content, move and paragraph-mark revision in the HTML with its id', () => {
    const missing = result.revisions.filter((revision) => revision.type !== 'format' && !analysis.index.revisionsInHtml.has(revision.id));
    expect(missing.map((revision) => `${revision.id} ${revision.family} ${JSON.stringify(revision.text)}`)).toEqual([]);
  });

  it('links every revision element to an item, and gives every item an element in the panels', () => {
    const document = parseRenderedHtml(result.html, parse);
    decorateDocument(document, analysis.items, analysis.index);
    expect(document.querySelectorAll('[data-author^="rev:"]:not([data-change-id])')).toHaveLength(0);
    const withElement = new Set([...document.querySelectorAll<HTMLElement>('[data-change-id]')].map((element) => element.dataset.changeId));
    const without = analysis.items.filter((item) => !withElement.has(item.id));
    expect(without.map((item) => `${item.id} ${item.kind}`)).toEqual([]);
  });

  it('keeps every note with its reference when one item is decided against the rest', async () => {
    for (const item of analysis.items) {
      for (const [decision, others] of [['reject', 'accept'], ['accept', 'reject']] as const) {
        const decisions = new Map(result.revisions.map((revision) => [revision.id, item.revisionIds.includes(revision.id) ? decision : others]));
        const exported = await exportDocx(new Uint8Array(result.redline), result.revisions, decisions);
        expect(noteProblems(exported), `${decision} ${item.kind} ${item.id}`).toEqual([]);
      }
    }
  });
});

describe.each(FIXTURES.map((fixture) => fixture.name))('Resolved column of %s', (name) => {
  it('shows the text the export gives, for any decisions and range, also after changing them', async () => {
    const read = (side: string) => new Uint8Array(readFileSync(`${FIXTURES_DIR}/${name}.${side}.docx`));
    const result = await runCompare(read('original'), read('edited'));
    const { analysis, document, itemTexts } = prepareRenderedDocument(result.html, (parsed) => analyzeComparison(result, () => parsed), parse);
    const { items, index, suggestedEndPoint } = analysis;
    const ignored = ignoredItems(items, itemTexts, DEFAULT_COMPARE_SETTINGS);
    const wrapper = document.body.ownerDocument.createElement('div');
    wrapper.append(...[...document.body.childNodes].map((node) => node.cloneNode(true)));
    const panel = prepareResolvedPanel(wrapper);
    const positions = blockPositions(index, suggestedEndPoint);
    // The full documents, then the detected range (if any), then the full documents again.
    const endPoints = suggestedEndPoint === null ? [null] : [null, suggestedEndPoint, null];
    let applied: ReadonlyMap<string, 'accept' | 'reject'> | null = null;
    for (const endPoint of endPoints) {
      const range = classify(items, index, endPoint, positions);
      const outOfRange = new Set(items.filter((item) => range.get(item.id) === 'outOfRange').map((item) => item.id));
      applyRangeOrder(panel, positions, endPoint, outOfRange);
      for (const [label, state] of parityStates(reviewableItems(items, range, ignored))) {
        const sides = resolvedItemDecisions(items, state, range, ignored);
        // From the previous state, only the changed items.
        applyResolution(panel, sides, applied ? items.map((item) => item.id).filter((id) => applied!.get(id) !== sides.get(id)) : undefined);
        applied = sides;
        const final = finalRevisionDecisions(items, state, range, 'accept', ignored);
        const exported = await exportDocx(new Uint8Array(result.redline), result.revisions, final, {
          formattingChoice: 'edited',
          outOfRange: new Set(items.filter((item) => outOfRange.has(item.id)).flatMap((item) => item.revisionIds)),
        });
        expect(resolvedText(wrapper), `${label}, end point ${endPoint}`).toEqual(docxText(exported));
      }
    }
  });
});

describe('notes only one version has', () => {
  it.each([
    ['footnote-remove', 'deleted'],
    ['endnote-add', 'inserted'],
    ['trailing-deletion', 'deleted'],
  ])('%s: the note is in the item of its reference', async (name, kind) => {
    const read = (side: string) => new Uint8Array(readFileSync(`${FIXTURES_DIR}/${name}.${side}.docx`));
    const result = await runCompare(read('original'), read('edited'));
    const analysis = analyzeComparison(result, parse);
    const note = result.revisions.find((revision) => revision.partUri !== '/word/document.xml')!;
    const item = analysis.items.find((i) => i.revisionIds.includes(note.id))!;
    expect(item).toMatchObject({ kind, location: { scope: 'body' } });
    expect(item.revisionIds).toHaveLength(2);
  });
});

describe('moved items', () => {
  const movedItems = async (name: string) => {
    const read = (side: string) => new Uint8Array(readFileSync(`${FIXTURES_DIR}/${name}.${side}.docx`));
    return analyzeComparison(await runCompare(read('original'), read('edited')), parse).items.filter((item) => item.kind === 'moved');
  };

  it('carry the wording at both ends when the move carries edits', async () => {
    const [plain] = await movedItems('move');
    expect(plain?.moveEdit).toBeUndefined();
    const [edited] = await movedItems('move-edit');
    expect(edited?.moveEdit).toEqual({
      from: 'Every morning the monks walked to the village in silence to receive their daily alms food.',
      to: 'Every morning the monks walked to the village in silence to receive their alms food.',
    });
  });
});
