// Rendering checks on every synthetic fixture pair (docs/architecture.md): every content, move and
// paragraph-mark revision is in the HTML with its id, and every item has an element in the
// panels; item-level export checks on the notes; and export round trips with inline edits. Export
// round trips per revision without edits are in src/engine/exportDocx.test.ts.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import { strFromU8, unzipSync } from 'fflate';
import { JSDOM } from 'jsdom';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyEdits } from '../src/engine/applyEdits';
import { listRevisions } from '../src/engine/docxodus';
import { exportDocx } from '../src/engine/exportDocx';
import { W_NS, unzipDocx, zipDocx } from '../src/engine/ooxml';
import type { RevisionListEntry } from '../src/engine/types';
import { runCompare, type ComparePipelineResult } from '../src/engine/pipeline';
import { analyzeComparison, type Analysis } from '../src/model/analyze';
import { finalRevisionDecisions, reviewableItems } from '../src/model/decisions';
import { DEFAULT_COMPARE_SETTINGS, ignoredItems } from '../src/model/equivalence';
import { blockPositions, classify } from '../src/model/range';
import { resolvedItemDecisions } from '../src/model/resolved';
import { decorateDocument, parseRenderedHtml, prepareRenderedDocument } from '../src/ui/renderedDocument';
import { originalText, visibleText } from '../src/model/paragraphEdit';
import { readBlockSegments } from '../src/ui/blockSegments';
import { applyRangeOrder, applyResolution, prepareResolvedPanel, resolvedText } from '../src/ui/resolvedView';
import { expectDeliverable } from './deliverable';
import { editableBlocks, editedOverrides, pickScenarios, redlineParagraphs, scopeOfBlock, scriptEdits, spaces, type RedlineParagraph } from './edits';
import { engineDecideOne, partsXml } from './engine-decide';
import { expectedText } from './expectedText';
import { FIXTURES, FIXTURES_DIR } from './fixtures/make-fixtures';
import { minimalDocx } from './minimal-docx';
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

describe.each(FIXTURES.map((fixture) => fixture.name))('inline edits on fixture %s', (name) => {
  const read = (side: string) => new Uint8Array(readFileSync(`${FIXTURES_DIR}/${name}.${side}.docx`));
  let result: ComparePipelineResult;
  let body: HTMLElement;
  let paragraphs: Map<string, RedlineParagraph>;
  const redline = () => new Uint8Array(result.redline);

  beforeAll(async () => {
    result = await runCompare(read('original'), read('edited'));
    body = prepareRenderedDocument(result.html, (parsed) => analyzeComparison(result, () => parsed), parse).document.body;
    paragraphs = await redlineParagraphs(redline());
  });

  it('reads each paragraph block’s segments with its redline paragraph’s Original and Edited text', () => {
    let checked = 0;
    for (const block of body.querySelectorAll<HTMLElement>(':is(p, h1, h2, h3, h4, h5, h6)[data-anchor]')) {
      const paragraph = paragraphs.get(`${scopeOfBlock(block)}:${block.dataset.anchor}`)!;
      if (paragraph.unpatchable) continue;
      const segments = readBlockSegments(block);
      expect(spaces(originalText(segments)), `Original of ${block.dataset.anchor}`).toBe(spaces(paragraph.original));
      expect(spaces(visibleText(segments)), `Edited of ${block.dataset.anchor}`).toBe(spaces(paragraph.edited));
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('changes no text when every editable paragraph is patched with its own segments', async () => {
    const patches = editableBlocks(body, paragraphs).map((block) => ({ unid: block.dataset.anchor!, scope: scopeOfBlock(block), segments: readBlockSegments(block) }));
    for (const decision of ['accept', 'reject'] as const) {
      const exported = await exportDocx(redline(), result.revisions, new Map(result.revisions.map((r) => [r.id, decision])), { edits: patches });
      expect(docxText(exported), decision).toEqual(docxText(read(decision === 'accept' ? 'edited' : 'original')));
    }
  });

  it('exports scripted edits: accept all, reject all and alternating decisions give the text the segments imply', async () => {
    const edits = pickScenarios(editableBlocks(body, paragraphs));
    if (edits.length === 0) return;
    const scripted = scriptEdits(body, edits);
    const revisions = [...result.revisions, ...scripted.revisions];
    const decide = (decision: (revision: RevisionListEntry, index: number) => 'accept' | 'reject') => new Map(revisions.map((r, i) => [r.id, decision(r, i)]));
    for (const [label, decisions] of [
      ['accept all', decide(() => 'accept')],
      ['reject all', decide(() => 'reject')],
      ['alternating', decide((_r, i) => (i % 2 === 0 ? 'accept' : 'reject'))],
      ['alternating from reject', decide((_r, i) => (i % 2 === 0 ? 'reject' : 'accept'))],
    ] as const) {
      const exported = await exportDocx(redline(), revisions, decisions, { edits: scripted.patches });
      if (process.env.EXPORT_DIR) {
        mkdirSync(process.env.EXPORT_DIR, { recursive: true });
        writeFileSync(join(process.env.EXPORT_DIR, `${name}-edits-${label.replace(/ /g, '-')}.docx`), exported);
      }
      const message = `${label}: ${edits.map((edit) => edit.label).join(', ')}`;
      expect(docxText(exported), message).toEqual(expectedText(redline(), result.revisions, decisions, editedOverrides(scripted, paragraphs, decisions)));
      if (label === 'reject all') expect(docxText(exported), message).toEqual(docxText(read('original')));
      await expectDeliverable(exported, read('original'));
    }
  });

  it('decides each revision of the patched redline as the engine’s own session does', async () => {
    const edits = pickScenarios(editableBlocks(body, paragraphs));
    if (edits.length === 0) return;
    const scripted = scriptEdits(body, edits);
    const files = unzipDocx(redline());
    const patchedRevisions = await applyEdits(files, [...result.revisions, ...scripted.revisions], scripted.patches);
    const patched = zipDocx(files);
    // The engine may group the markup into revisions differently: each of its revisions is decided
    // through the revisions of ours whose markup it covers. It splits a formatting change that
    // edits interrupt into several; those are left to the text checks.
    const keysOf = (revision: RevisionListEntry) => revision.constituentKeys.map((key) => `${revision.partUri} ${key}`);
    let checked = 0;
    for (const engineRevision of await listRevisions(patched)) {
      const keys = new Set(keysOf(engineRevision));
      const ours = patchedRevisions.filter((revision) => keysOf(revision).some((key) => keys.has(key)));
      if (ours.some((revision) => keysOf(revision).some((key) => !keys.has(key)))) {
        expect(engineRevision.type, engineRevision.id).toBe('format');
        continue;
      }
      expect(new Set(ours.flatMap(keysOf)), engineRevision.id).toEqual(keys);
      checked++;
      for (const [decision, others] of [['reject', 'accept'], ['accept', 'reject']] as const) {
        const decisions = new Map(patchedRevisions.map((revision) => [revision.id, ours.includes(revision) ? decision : others]));
        const exported = await exportDocx(patched, patchedRevisions, decisions);
        const expected = await engineDecideOne(patched, engineRevision.id, decision);
        const message = `${decision} ${engineRevision.id} (${engineRevision.family} ${JSON.stringify(engineRevision.text)})`;
        expect(docxText(exported), message).toEqual(docxText(expected));
        expect(partsXml(exported), message).toEqual(partsXml(expected));
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('inline edits in a heading', () => {
  it('export with the heading’s new text, which keeps its style', async () => {
    const original = minimalDocx([{ heading: 1, text: 'The old monastery' }, 'Every morning the monks walked to the village.']);
    const edited = minimalDocx([{ heading: 1, text: 'The old forest monastery' }, 'Every morning the monks walked to the village.']);
    const result = await runCompare(original, edited);
    const body = prepareRenderedDocument(result.html, (parsed) => analyzeComparison(result, () => parsed), parse).document.body;
    const paragraphs = await redlineParagraphs(new Uint8Array(result.redline));
    const [heading] = editableBlocks(body, paragraphs).filter((block) => block.matches('h1'));
    const scripted = scriptEdits(body, [{ unid: heading!.dataset.anchor!, label: 'heading', change: (visible) => visible.replace('The old', 'The very old') }]);
    const revisions = [...result.revisions, ...scripted.revisions];
    for (const decision of ['accept', 'reject'] as const) {
      const decisions = new Map(revisions.map((revision) => [revision.id, decision]));
      const exported = await exportDocx(new Uint8Array(result.redline), revisions, decisions, { edits: scripted.patches });
      expect(docxText(exported)).toEqual(decision === 'accept' ? ['The very old forest monastery', 'Every morning the monks walked to the village.'] : docxText(original));
      expect(strFromU8(unzipSync(exported)['word/document.xml']!)).toContain('<w:pStyle w:val="Heading1"');
      await expectDeliverable(exported, original);
    }
  });
});
