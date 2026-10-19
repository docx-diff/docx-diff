// Engine and model checks on the sample pair (expected numbers: docs/measurements.md).
// One compare result is shared by the whole file, since a compare takes several seconds.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { docxDiffRejectRevisions } from 'docxodus/core';
import { JSDOM } from 'jsdom';
import { beforeAll, describe, expect, it } from 'vitest';
import { acceptAll, compare, listRevisions } from '../src/engine/docxodus';
import { reconcileNotes } from '../src/engine/notes';
import { exportDocx, type ExportOptions } from '../src/engine/exportDocx';
import { runCompare, type ComparePipelineResult } from '../src/engine/pipeline';
import type { FinalDecision, RevisionListEntry } from '../src/engine/types';
import { analyzeComparison, type Analysis } from '../src/model/analyze';
import { isBareParagraphMark } from '../src/model/changes';
import { revisionTexts, visibleText } from '../src/model/paragraphEdit';
import { exportComments } from '../src/model/comments';
import { INITIAL_DECISIONS, finalRevisionDecisions, reviewableItems } from '../src/model/decisions';
import { buildOutline } from '../src/model/outline';
import { resolvedItemDecisions } from '../src/model/resolved';
import { blockPositions, classify, spanningItems } from '../src/model/range';
import { DEFAULT_COMPARE_SETTINGS, ignoredItems } from '../src/model/equivalence';
import { decorateDocument, markCommon, mergeJoinedParagraphs, parseRenderedHtml, prepareRenderedDocument } from '../src/ui/renderedDocument';
import { applyRangeOrder, applyResolution, prepareResolvedPanel, replaceResolvedBlock, resolvedText } from '../src/ui/resolvedView';
import { EditSession } from '../src/ui/useEdits';
import { readBlockSegments, renderBlockSegments } from '../src/ui/blockSegments';
import { unmappedBlocks } from './block-mapping';
import { SCENARIOS, editableBlocks, editedOverrides, pickScenarios, redlineParagraphs, scopeOfBlock, scriptEdits, type RedlineParagraph, type ScriptedEdit, type ScriptedResult } from './edits';
import { expectDeliverable, expectTrackedDeliverable } from './deliverable';
import { expectedText } from './expectedText';
import { documentLook, lookDifference } from './look';
import { initNodeEngine } from './node-engine';
import { parityStates } from './parity';
import { describeWithSamples, readSamples } from './samples';
import { docxText } from './text';

function countBy<T>(values: readonly T[], key: (value: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[key(value)] = (counts[key(value)] ?? 0) + 1;
  return counts;
}

describeWithSamples('sample pair', () => {
  let result: ComparePipelineResult;
  let analysis: Analysis;

  beforeAll(async () => {
    await initNodeEngine();
    const { original, edited } = readSamples();
    result = await runCompare(original, edited);
    analysis = analyzeComparison(result, (html) => new JSDOM(html).window.document);
  });

  describe('compare settings', () => {
    it('gives the expected revision counts per family', () => {
      const { revisions } = result;
      expect(revisions).toHaveLength(796);
      expect(countBy(revisions, (r) => r.family)).toEqual({
        properties_change: 378,
        content_delete: 200,
        content_insert: 167,
        paragraph_mark: 49,
        move: 2,
      });
    });

    it('reports no header/footer or numbering revisions', () => {
      const { revisions } = result;
      expect(revisions.filter((r) => /header|footer/i.test(r.partUri))).toEqual([]);
      expect(revisions.filter((r) => r.family === 'numbering_change')).toEqual([]);
      expect(new Set(revisions.map((r) => r.partUri))).toEqual(new Set(['/word/document.xml', '/word/footnotes.xml']));
    });

    it('knows the inputs had no tracked changes of their own', () => {
      expect(result.inputsHadRevisions).toBe(false);
    });

    it('has the tail as one paragraph-mark deletion of 117,771 characters over 579 anchors', () => {
      const tail = result.revisions.reduce((a, b) => (b.text.length > a.text.length ? b : a));
      expect(tail).toMatchObject({ family: 'paragraph_mark', type: 'delete' });
      expect(tail.text).toHaveLength(117_771);
      expect(tail.affectedAnchors).toHaveLength(579);
    });

    it('gives identical revision ids on a second compare', async () => {
      const { original, edited } = readSamples();
      const again = await listRevisions(await compare(original, edited));
      expect(again.map((r) => r.id)).toEqual(result.revisions.map((r) => r.id));
    });

    it('renders every revision tag-addressable', () => {
      console.log('sample pair timings (ms):', result.timings);
      expect(result.html).toContain('data-author="rev:');
      expect(result.html).not.toContain('data-author="Docxodus"');
    });
  });

  describe('change items', () => {
    const revisionById = () => new Map(result.revisions.map((r) => [r.id, r]));
    const nonFormatting = () => result.revisions.filter((r) => r.type !== 'format');

    it('puts every engine revision in exactly one item', () => {
      const ids = analysis.items.flatMap((item) => item.revisionIds);
      expect(ids).toHaveLength(result.revisions.length);
      expect(new Set(ids)).toEqual(new Set(result.revisions.map((r) => r.id)));
    });

    it('gives the recorded item counts per kind', () => {
      expect(analysis.items).toHaveLength(613);
      expect(countBy(analysis.items, (i) => i.kind)).toEqual({
        formatting: 378,
        replaced: 141,
        deleted: 48,
        inserted: 27,
        paragraph: 17,
        moved: 2,
      });
    });

    it('folds 26 of the 43 bare paragraph marks (6 of the 49 paragraph marks carry text)', () => {
      const byId = revisionById();
      const bare = nonFormatting().filter(isBareParagraphMark);
      expect(bare).toHaveLength(43);
      const folded = analysis.items
        .filter((item) => item.revisionIds.length > 1)
        .flatMap((item) => item.revisionIds.map((id) => byId.get(id)!))
        .filter(isBareParagraphMark);
      expect(folded).toHaveLength(26);
    });

    it('has 110 delete→insert and 143 insert→delete neighbours sharing an anchor, of which 141 touch: all insertion first', () => {
      const shares = (a: RevisionListEntry, b: RevisionListEntry) =>
        a.affectedAnchors.some((x) => b.affectedAnchors.some((y) => x.unid === y.unid));
      const sequence = nonFormatting();
      const neighbours = { deleteInsert: 0, insertDelete: 0 };
      sequence.slice(1).forEach((b, i) => {
        const a = sequence[i]!;
        if (!shares(a, b)) return;
        if (a.family === 'content_delete' && b.family === 'content_insert') neighbours.deleteInsert++;
        if (a.family === 'content_insert' && b.family === 'content_delete') neighbours.insertDelete++;
      });
      expect(neighbours).toEqual({ deleteInsert: 110, insertDelete: 143 });

      const byId = revisionById();
      const pairs = analysis.items
        .filter((item) => item.kind === 'replaced')
        .map((item) => item.revisionIds.map((id) => byId.get(id)!).find((r) => !isBareParagraphMark(r))!.family);
      expect(countBy(pairs, (family) => family)).toEqual({ content_insert: 141 });
    });

    it('puts the deletions of the notes 5–20 in the body items that delete their references', () => {
      const byId = revisionById();
      const withNotes = analysis.items.filter((item) => item.revisionIds.some((id) => byId.get(id)!.partUri === '/word/footnotes.xml') && item.location.scope === 'body');
      expect(withNotes.map((item) => item.kind)).toEqual(['deleted', 'deleted']);
      const noteIds = withNotes.map((item) => [
        ...new Set(item.anchors.map((unid) => analysis.index.blockByUnid.get(unid)!).filter((b) => b.scope === 'fn').map((b) => Number(b.noteId))),
      ]);
      expect(noteIds).toEqual([[5], Array.from({ length: 15 }, (_, i) => i + 6)]);
    });

    it('describes formatting items from the HTML titles where the HTML has their elements', () => {
      const formatting = analysis.items.filter((item) => item.kind === 'formatting');
      expect(formatting.filter((item) => item.description)).toHaveLength(355);
      expect(formatting.map((item) => item.description)).toContain('Font size changed, Font changed');
    });

    it('locates footnote items with their note id', () => {
      const notes = analysis.items.filter((item) => item.location.scope === 'footnote');
      // 35 footnote revisions; two pairs are Replaced items, and the 16 deletions of the notes 5–20
      // (which the Edited document does not have) are in the items that delete their references.
      expect(notes).toHaveLength(17);
      expect(notes.every((item) => /^\d+$/.test(item.location.noteId ?? ''))).toBe(true);
    });
  });

  describe('document index', () => {
    it('has 775 anchored blocks and 747 Original body paragraphs (14 empty ones between list items)', () => {
      expect(analysis.index.blocks).toHaveLength(775);
      expect(analysis.index.bodyParagraphs).toHaveLength(747);
      expect(analysis.index.noteRefs.size).toBe(20);
    });

    it('contains every revision anchor except section anchors', () => {
      const anchors = result.revisions.flatMap((r) => r.affectedAnchors);
      const missing = anchors.filter((anchor) => !analysis.index.blockByUnid.has(anchor.unid));
      expect(missing.map((anchor) => anchor.kind)).toEqual(['sec']);
    });

    it('maps every paragraph block to its redline paragraph by Unid', async () => {
      const start = performance.now();
      const { checked, unmapped } = await unmappedBlocks(result.redline, result.html);
      console.log(`Block mapping on the sample: ${Math.round(performance.now() - start)} ms (with HTML parse)`);
      expect(checked).toBe(775);
      expect(unmapped).toEqual([]);
    });

    it('shows every content, move and paragraph-mark revision, and 355 of 378 formatting revisions', () => {
      const shown = (r: RevisionListEntry) => analysis.index.revisionsInHtml.has(r.id);
      expect(result.revisions.filter((r) => r.type !== 'format' && !shown(r))).toEqual([]);
      expect(result.revisions.filter((r) => r.type === 'format' && shown(r))).toHaveLength(355);
    });
  });

  describe('panel document', () => {
    it('links every revision element to an item, and gives every formatting item an element (23 via the paragraph fallback)', () => {
      const document = parseRenderedHtml(result.html, (html) => new JSDOM(html).window.document);
      decorateDocument(document, analysis.items, analysis.index);
      expect(document.querySelectorAll('[data-author^="rev:"]:not([data-change-id])')).toHaveLength(0);
      const withElement = new Set([...document.querySelectorAll<HTMLElement>('[data-change-id]')].map((e) => e.dataset.changeId));
      const formatting = analysis.items.filter((item) => item.kind === 'formatting');
      expect(formatting.filter((item) => !withElement.has(item.id))).toEqual([]);
      expect(document.querySelectorAll('.rev-format-marker')).toHaveLength(23);
    });

    it('marks the blank paragraphs, nearly all of them blank lines the Edited lacks (FR-20b)', () => {
      const { document } = prepareRenderedDocument(result.html, (parsed) => analyzeComparison(result, () => parsed), (html) => new JSDOM(html).window.document);
      const blank = [...document.body.querySelectorAll('[data-blank]')];
      const count = (selector: string) => blank.filter((block) => block.matches(selector)).length;
      expect({ blank: blank.length, notInEdited: count('.not-in-edited'), inBoth: count(':not(.not-in-edited, .not-in-original)') }).toEqual({ blank: 368, notInEdited: 337, inBoth: 31 });
      // What each panel shows of them without the setting: all in the Original's, none in the
      // Edited's, where the text before each of the 31 both versions have joins into it (the engine
      // keeps the blank line's mark, deleting the text's).
      const shown = (side: 'left' | 'right') => {
        const panel = document.body.cloneNode(true) as HTMLElement;
        mergeJoinedParagraphs(panel, side);
        const missing = side === 'left' ? '.not-in-original' : '.not-in-edited';
        return {
          blank: panel.querySelectorAll(`[data-blank]:not(.joined-text, .merged-into-next, ${missing})`).length,
          joined: panel.querySelectorAll('.joined-text').length,
        };
      };
      expect({ left: shown('left'), right: shown('right') }).toEqual({ left: { blank: 368, joined: 0 }, right: { blank: 0, joined: 31 } });
    });
  });

  describe('outline', () => {
    it("lists the Edited's 8 headings, though the redline renders only 2 of them as headings", () => {
      expect(result.headings.original).toHaveLength(34);
      expect(result.headings.edited.map((heading) => heading.level)).toEqual([1, 2, 3, 3, 3, 3, 3, 3]);
      const { document } = prepareRenderedDocument(result.html, (parsed) => analyzeComparison(result, () => parsed), (html) => new JSDOM(html).window.document);
      const outline = buildOutline(document.body, result.headings);
      expect(outline.map((entry) => entry.text)).toEqual(result.headings.edited.map((heading) => heading.text));
      expect(new Set(outline.map((entry) => entry.unid)).size).toBe(8);
      expect(outline.filter((entry) => !entry.inOriginal).map((entry) => entry.text)).toEqual(['KELLÉKEK KÉRELME']);
    });
  });

  describe('changes that leave the text the same', () => {
    const prepare = () =>
      prepareRenderedDocument(result.html, (parsed) => analyzeComparison(result, () => parsed), (html) => new JSDOM(html).window.document);
    const NONE = { ignoreQuotes: false, ignoreDashes: false, ignoreWhitespace: false };

    it('combines the 15 typed list numbers replaced by automatic numbering into formatting items', () => {
      const { analysis: prepared } = prepare();
      const typed = prepared.items.filter((item) => item.description === 'Typed list number replaced by automatic numbering');
      expect(typed.map((item) => item.text)).toEqual(Array.from({ length: 15 }, (_, i) => `${i + 1}.`));
      expect(prepared.items).toHaveLength(598);
      expect(prepared.items.flatMap((item) => item.revisionIds)).toHaveLength(result.revisions.length);
    });

    it('relabels the 4 replacements of identical text (words split over runs) as formatting', () => {
      const { analysis: prepared } = prepare();
      const same = prepared.items.filter((item) => item.description === 'Same text, different formatting or run structure');
      expect(same.map((item) => item.text)).toEqual(['Pāṭimokkha', 'Pāṭimokkha', 'Pāṭimokkha', 'pavāraṇā']);
      expect(same.every((item) => item.kind === 'formatting')).toBe(true);
    });

    it('ignores quote, dash and whitespace changes per setting', () => {
      const { analysis: prepared, itemTexts } = prepare();
      const ignored = (settings: typeof NONE) => ignoredItems(prepared.items, itemTexts, settings);
      expect(ignored(NONE).size).toBe(0);
      const quotes = [...ignored({ ...NONE, ignoreQuotes: true })].map((id) => prepared.items.find((item) => item.id === id)!);
      expect(quotes.map((item) => `${item.removedText}→${item.addedText}`)).toContain('„szentelt"→„szentelt”');
      // 6 quote changes and one "...'" → "…’".
      expect(quotes).toHaveLength(7);
      expect(ignored({ ...NONE, ignoreDashes: true }).size).toBe(8);
      expect(ignored({ ...NONE, ignoreWhitespace: true }).size).toBe(35);
      expect(ignored(DEFAULT_COMPARE_SETTINGS).size).toBe(54);
    });

    it('shows the quote-only edges of a replacement as unchanged: „szövegek "az" → „szutták szövegei “az"', () => {
      const { document, analysis: prepared } = prepare();
      const item = prepared.items.find((i) => i.removedText.includes('szövegek "az'))!;
      expect(item.addedText).toContain('szutták szövegei “az');
      const parts = (selector: string) =>
        [...document.body.querySelectorAll<HTMLElement>(`${selector}[data-change-id="${item.id}"]`)].map((e) => [e.textContent, e.dataset.commonNeeds ?? null]);
      expect(parts('del').at(-1)).toEqual(['"az', 'ignoreQuotes']);
      expect(parts('ins').at(-1)).toEqual(['“az', 'ignoreQuotes']);
      markCommon(document.body, DEFAULT_COMPARE_SETTINGS);
      const common = document.body.querySelectorAll(`[data-change-id="${item.id}"].change-common`);
      // In document order: the insertion comes first, then the deletion. The inserted space is a
      // no-break space (equal to a space with the whitespace setting).
      expect([...common].map((e) => e.textContent)).toEqual(['\u00a0', '“az', ' ', '"az']);
      const withEdges = prepared.items.filter((i) => document.body.querySelector(`[data-change-id="${i.id}"][data-common-needs]`));
      expect(withEdges).toHaveLength(34);
    });

    it('shows a paragraph joined into a new list item after the list number in the Edited panel', () => {
      const { document } = prepare();
      const panel = document.body.ownerDocument.createElement('div');
      panel.append(...[...document.body.childNodes].map((node) => node.cloneNode(true)));
      mergeJoinedParagraphs(panel, 'right');
      const item = [...panel.querySelectorAll<HTMLElement>('[data-source-anchor-id^="li:body:"]')].find((block) =>
        block.textContent!.includes('Tilos a szerzeteseknek'),
      )!;
      const text = item.textContent!;
      expect(text.indexOf('1.')).toBeLessThan(text.indexOf('Tilos a szerzeteseknek'));
      expect(panel.querySelectorAll('.merged-into-next').length).toBeGreaterThan(0);
    });
  });

  describe('comparison range', () => {
    it('proposes the first paragraph of the tail revision as the end point', () => {
      const tail = result.revisions.reduce((a, b) => (b.text.length > a.text.length ? b : a));
      const tailItem = analysis.items.find((item) => item.revisionIds.includes(tail.id))!;
      expect(analysis.suggestedEndPoint).toBe(168);
      expect(analysis.index.bodyParagraphs[168]).toBe(tail.affectedAnchors[0]!.unid);
      expect(analysis.index.bodyParagraphs.length - 168).toBe(579);

      const classes = classify(analysis.items, analysis.index, analysis.suggestedEndPoint);
      expect(classes.get(tailItem.id)).toBe('outOfRange');
    });

    it('puts the tail (with the deletions of its notes 6–20) out of range, and nothing else', () => {
      const classes = classify(analysis.items, analysis.index, analysis.suggestedEndPoint);
      const out = analysis.items.filter((item) => classes.get(item.id) === 'outOfRange');
      const tail = result.revisions.reduce((a, b) => (b.text.length > a.text.length ? b : a));
      const tailItem = out.find((item) => item.revisionIds.includes(tail.id))!;
      const noteBlocks = tailItem.anchors.map((unid) => analysis.index.blockByUnid.get(unid)!).filter((block) => block.scope === 'fn');
      expect([...new Set(noteBlocks.map((block) => Number(block.noteId)))]).toEqual(Array.from({ length: 15 }, (_, i) => i + 6));
      expect(tailItem.revisionIds).toHaveLength(16);
      expect(out.filter((item) => item.location.scope === 'footnote')).toEqual([]);
      // The Edited's closing paragraphs, which the engine placed after the deleted tail, are in range.
      expect(countBy(out, (item) => `${item.kind}/${item.location.scope}`)).toEqual({ 'deleted/body': 1 });
      const closing = analysis.items.find((item) => item.addedText.includes('Átnézve eddig'))!;
      expect(classes.get(closing.id)).toBe('inRange');
    });

    it('keeps the two moves in range: they carry the last paragraphs before the end point to after the tail', () => {
      const classes = classify(analysis.items, analysis.index, analysis.suggestedEndPoint);
      const positions = blockPositions(analysis.index, analysis.suggestedEndPoint);
      const blockOrder = new Map(analysis.index.blocks.map((block, i) => [block.unid, i]));
      const lastOriginal = blockOrder.get(analysis.index.bodyParagraphs.at(-1)!)!;
      const moves = analysis.items.filter((item) => item.kind === 'moved');
      expect(moves).toHaveLength(2);
      for (const item of moves) {
        expect(classes.get(item.id)).toBe('inRange');
        // The destination comes after the deleted tail in the redline, and is placed before the end point.
        expect(item.anchors.some((unid) => blockOrder.get(unid)! > lastOriginal)).toBe(true);
        expect(item.anchors.every((unid) => positions.get(unid)! < analysis.suggestedEndPoint!)).toBe(true);
      }
      expect(spanningItems(analysis.items, analysis.index, analysis.suggestedEndPoint, classes)).toEqual([]);
    });

    it('keeps every item in range without an end point', () => {
      const classes = classify(analysis.items, analysis.index, null);
      expect([...classes.values()].every((c) => c === 'inRange')).toBe(true);
    });
  });

  describe('export', () => {
    type Decision = 'accept' | 'reject';
    const decide = (decision: (revisionId: string) => Decision) => new Map(result.revisions.map((r) => [r.id, decision(r.id)]));
    /** Each item's decision applied to all its revisions. */
    const byItem = <D extends FinalDecision = Decision>(decision: (item: Analysis['items'][number], index: number) => D) => {
      const decisions = new Map<string, D>();
      analysis.items.forEach((item, index) => item.revisionIds.forEach((id) => decisions.set(id, decision(item, index))));
      return decisions;
    };
    /** Exports; with EXPORT_DIR set, also writes the file there (for scripts/check-libreoffice.sh). */
    const exportWith = async (decisions: Map<string, FinalDecision>, name: string, options?: ExportOptions) => {
      const start = performance.now();
      const exported = await exportDocx(result.redline, result.revisions, decisions, options);
      const ms = Math.round(performance.now() - start);
      if (process.env.EXPORT_DIR) {
        mkdirSync(process.env.EXPORT_DIR, { recursive: true });
        writeFileSync(join(process.env.EXPORT_DIR, `sample-${name}.docx`), exported);
      }
      return { exported, ms };
    };

    it('accepting all gives the Edited text', async () => {
      const { exported, ms } = await exportWith(decide(() => 'accept'), 'accept-all');
      console.log(`sample pair export, all accepted: ${ms} ms`);
      expect(docxText(exported)).toEqual(docxText(readSamples().edited));
      expect(expectedText(result.redline, result.revisions, decide(() => 'accept'))).toEqual(docxText(exported));
      await expectDeliverable(exported, readSamples().original);
    });

    it('rejecting all gives the Original text', async () => {
      const { exported, ms } = await exportWith(decide(() => 'reject'), 'reject-all');
      console.log(`sample pair export, all rejected: ${ms} ms`);
      expect(docxText(exported)).toEqual(docxText(readSamples().original));
      expect(expectedText(result.redline, result.revisions, decide(() => 'reject'))).toEqual(docxText(exported));
      await expectDeliverable(exported, readSamples().original);
    });

    it('alternating decisions per item give the text each decision implies', async () => {
      for (const first of ['accept', 'reject'] as const) {
        const other = first === 'accept' ? 'reject' : 'accept';
        const decisions = byItem((_item, index) => (index % 2 === 0 ? first : other));
        const { exported, ms } = await exportWith(decisions, `alternating-from-${first}`);
        console.log(`sample pair export, alternating from ${first}: ${ms} ms`);
        const text = docxText(exported);
        expect(text).toEqual(expectedText(result.redline, result.revisions, decisions));
        expect(text).not.toEqual(docxText(readSamples().original));
        expect(text).not.toEqual(docxText(readSamples().edited));
        await expectDeliverable(exported, readSamples().original);
      }
    });

    it.each(['edited', 'original'] as const)(
      'alternating text decisions with the %s formatting keep the text and use only that version’s look',
      async (choice) => {
        const formatting: Decision = choice === 'edited' ? 'accept' : 'reject';
        let text = 0;
        const decisions = byItem((item) => (item.kind === 'formatting' ? formatting : text++ % 2 === 0 ? 'accept' : 'reject'));
        const { exported, ms } = await exportWith(decisions, `alternating-${choice}-look`, { formattingChoice: choice, outOfRange: new Set() });
        console.log(`sample pair export, alternating with the ${choice} look: ${ms} ms`);
        const { exported: withoutLook } = await exportWith(decisions, `alternating-${choice}`);
        expect(docxText(exported)).toEqual(docxText(withoutLook));
        expect(docxText(exported)).toEqual(expectedText(result.redline, result.revisions, decisions));

        const reference = documentLook((await exportWith(decide(() => formatting), `all-${formatting}`)).exported);
        const none = { runs: [], paragraphs: [], marks: [] };
        expect(lookDifference(documentLook(exported), reference)).toEqual(none);
        expect(lookDifference(documentLook(withoutLook), reference).runs.length).toBeGreaterThan(0);
        await expectDeliverable(exported, readSamples().original);
      },
    );

    it('with the detected range and the Edited formatting, the look leaves the tail as it is', async () => {
      const classes = classify(analysis.items, analysis.index, analysis.suggestedEndPoint);
      const outOfRange = new Set(analysis.items.filter((item) => classes.get(item.id) === 'outOfRange').flatMap((item) => item.revisionIds));
      const decisions = byItem((item) => (classes.get(item.id) === 'outOfRange' ? 'reject' : 'accept'));
      const { exported } = await exportWith(decisions, 'range-edited-look', { formattingChoice: 'edited', outOfRange });
      const { exported: withoutLook } = await exportWith(decisions, 'range', { outOfRange });
      expect(docxText(exported)).toEqual(docxText(withoutLook));
      // The tail keeps the Original's Palatino (FR-39a).
      expect([...documentLook(exported).runs].some((run) => run.includes('Palatino'))).toBe(true);
      await expectDeliverable(exported, readSamples().original);
    });

    it('with the detected range, alternating decisions and a comment on every text change, anchors each comment once and keeps the text', async () => {
      const classes = classify(analysis.items, analysis.index, analysis.suggestedEndPoint);
      const outOfRange = new Set(analysis.items.filter((item) => classes.get(item.id) === 'outOfRange').flatMap((item) => item.revisionIds));
      let text = 0;
      const decisions = byItem((item) =>
        classes.get(item.id) === 'outOfRange' ? 'reject' : item.kind === 'formatting' ? 'accept' : text++ % 2 === 0 ? 'accept' : 'reject',
      );
      const state = { ...INITIAL_DECISIONS, comments: Object.fromEntries(analysis.items.map((item) => [item.id, `On ${item.id}`])) };
      const comments = exportComments(analysis.items, state, classes, decisions);
      expect(comments.length).toBe(analysis.items.filter((item) => item.kind !== 'formatting' && classes.get(item.id) !== 'outOfRange').length);
      const relocated: string[][] = [];
      const options = { formattingChoice: 'edited' as const, outOfRange };
      const { exported, ms } = await exportWith(decisions, 'range-comments', { ...options, comments, onCommentsRelocated: (ids) => relocated.push(...ids) });
      expect(relocated).toEqual([]);
      const { exported: withoutComments, ms: withoutMs } = await exportWith(decisions, 'range-no-comments', options);
      console.log(`sample pair export, ${comments.length} comments: ${ms} ms (without them: ${withoutMs} ms)`);
      expect(docxText(exported)).toEqual(docxText(withoutComments));
      const files = unzipSync(exported);
      const body = strFromU8(files['word/document.xml']!);
      const count = (pattern: RegExp) => body.match(pattern)?.length ?? 0;
      expect(count(/<w:commentReference /g)).toBe(comments.length);
      expect(count(/<w:commentRangeStart /g)).toBe(comments.length);
      expect(count(/<w:commentRangeEnd /g)).toBe(comments.length);
      expect(strFromU8(files['word/comments.xml']!).match(/<w:comment /g)).toHaveLength(comments.length);
      await expectDeliverable(exported, readSamples().original);
    });

    it('with the detected range, every third text change tracked and a comment on every one: resolving them in Word gives the export deciding them so', async () => {
      const classes = classify(analysis.items, analysis.index, analysis.suggestedEndPoint);
      const outOfRange = new Set(analysis.items.filter((item) => classes.get(item.id) === 'outOfRange').flatMap((item) => item.revisionIds));
      const withTracked = (tracked: FinalDecision) => {
        let text = 0;
        return byItem<FinalDecision>((item) =>
          classes.get(item.id) === 'outOfRange'
            ? 'reject'
            : item.kind === 'formatting'
              ? 'accept'
              : ([tracked, 'accept', 'reject'] as const)[text++ % 3]!,
        );
      };
      const decisions = withTracked('track');
      const state = { ...INITIAL_DECISIONS, comments: Object.fromEntries(analysis.items.map((item) => [item.id, `On ${item.id}`])) };
      const comments = exportComments(analysis.items, state, classes, decisions);
      const options = { formattingChoice: 'edited' as const, outOfRange };
      const relocated: string[][] = [];
      const { exported, ms } = await exportWith(decisions, 'range-tracked', { ...options, comments, onCommentsRelocated: (ids) => relocated.push(...ids) });
      console.log(`sample pair export, every third text change tracked: ${ms} ms`);
      expect(relocated).toEqual([]);
      expect((await listRevisions(exported)).length).toBeGreaterThan(0);
      for (const [resolve, decision] of [
        [acceptAll, 'accept'],
        [docxDiffRejectRevisions, 'reject'],
      ] as const) {
        const { exported: expected } = await exportWith(withTracked(decision), `range-tracked-${decision}`, options);
        expect(docxText(reconcileNotes(await resolve(exported), exported))).toEqual(docxText(expected));
      }
      const body = strFromU8(unzipSync(exported)['word/document.xml']!);
      expect(body.match(/<w:commentReference /g)).toHaveLength(comments.length);
      expect(strFromU8(unzipSync(exported)['word/comments.xml']!)).toContain('>Undecided:<');
      await expectTrackedDeliverable(exported, readSamples().original, result.redline);
    });

    it('the trailing region out of range and the rest accepted gives the Edited text followed by the Original tail', async () => {
      const classes = classify(analysis.items, analysis.index, analysis.suggestedEndPoint);
      const outOfRange = new Set(analysis.items.filter((item) => classes.get(item.id) === 'outOfRange').flatMap((item) => item.revisionIds));
      const decisions = byItem((item) => (classes.get(item.id) === 'outOfRange' ? 'reject' : 'accept'));
      const { exported } = await exportWith(decisions, 'range', { outOfRange });
      const { original, edited } = readSamples();
      const body = (bytes: Uint8Array) => docxText(bytes, ['word/document.xml']);
      const [editedBody, originalBody] = [body(edited), body(original)];

      // The Edited body ends with its "reviewed up to here" note, which the engine placed after the
      // deleted tail: it is in range, and the export puts it back before the kept tail.
      expect(editedBody.at(-1)).toBe('(Átnézve eddig, Stillness Flowing p.257)');
      const tail = result.revisions.reduce((a, b) => (b.text.length > a.text.length ? b : a));
      const firstTailParagraph = tail.text.split('¶').find((paragraph) => paragraph.trim())!;
      const tailStart = originalBody.indexOf(firstTailParagraph.replace(/\s+/g, ' ').trim());
      expect(tailStart).toBeGreaterThan(0);

      // The two moves (in range, accepted) bring the last two paragraphs before the tail, with the
      // editor's changes; the export puts them back before the kept tail.
      expect(editedBody.slice(-3, -1).map((line) => line.slice(0, 40))).toEqual(['Luang Porra mély benyomást tett a Hanyat', 'A szigorú napirendet úgy alakították ki,']);
      expect(body(exported)).toEqual([...editedBody, ...originalBody.slice(tailStart)]);
      // The notes: the Edited's (1–4; the editor deleted note 5), then the tail's notes 6–20.
      const notes = (bytes: Uint8Array) => docxText(bytes, ['word/footnotes.xml']);
      const tailNotes = notes(original).slice(notes(original).length - (notes(exported).length - notes(edited).length));
      expect(notes(exported)).toEqual([...notes(edited), ...tailNotes]);
      expect(tailNotes.length).toBeGreaterThanOrEqual(15);
      await expectDeliverable(exported, original);
    });

    it('with the detected range, rejecting the two moves keeps those paragraphs before the tail in their Original wording', async () => {
      const classes = classify(analysis.items, analysis.index, analysis.suggestedEndPoint);
      const outOfRange = new Set(analysis.items.filter((item) => classes.get(item.id) === 'outOfRange').flatMap((item) => item.revisionIds));
      const decisions = byItem((item) => (classes.get(item.id) === 'outOfRange' || item.kind === 'moved' ? 'reject' : 'accept'));
      const { exported } = await exportWith(decisions, 'range-moves-rejected', { outOfRange });
      const { original, edited } = readSamples();
      const body = (bytes: Uint8Array) => docxText(bytes, ['word/document.xml']);
      const [editedBody, originalBody] = [body(edited), body(original)];
      const tail = result.revisions.reduce((a, b) => (b.text.length > a.text.length ? b : a));
      const tailStart = originalBody.indexOf(tail.text.split('¶').find((paragraph) => paragraph.trim())!.replace(/\s+/g, ' ').trim());
      const moved = originalBody.slice(tailStart - 2, tailStart);
      expect(moved.map((line) => line.slice(0, 40))).toEqual(['Luang Porra mély benyomást tett a Hanyat', 'A szigorú napirendet azért alakították k']);
      // The moves' sources sit between the deleted and the inserted versions of the list items 7.–/DN 16/.
      expect(body(exported)).toEqual([...editedBody.slice(0, -6), ...moved, ...editedBody.slice(-6, -3), editedBody.at(-1), ...originalBody.slice(tailStart)]);
      await expectDeliverable(exported, original);
    });
  });

  describe('export with inline edits', () => {
    let body: HTMLElement;
    let paragraphs: Map<string, RedlineParagraph>;
    let edits: ScriptedEdit[];
    let scripted: ScriptedResult;
    let revisions: RevisionListEntry[];
    /** Item id of each revision, the edits' new items included. */
    const itemOf = new Map<string, string>();

    beforeAll(async () => {
      body = prepareRenderedDocument(result.html, (parsed) => analyzeComparison(result, () => parsed), (html) => new JSDOM(html).window.document).document.body;
      paragraphs = await redlineParagraphs(result.redline);
      const editable = editableBlocks(body, paragraphs);
      // The sample has no editable heading: each of its `h*` blocks has a paragraph-mark change
      // (headings: test/fixture-pairs.test.ts). Nor any table.
      const inScope = (scope: string) => editable.filter((block) => scopeOfBlock(block) === scope);
      edits = [...pickScenarios(inScope('body')), ...pickScenarios(inScope('fn'), ['edit inside an insertion', 'insert a word', 'delete a word'])];
      expect(edits.map((edit) => edit.label)).toEqual([...SCENARIOS, 'edit inside an insertion', 'insert a word', 'delete a word']);
      scripted = scriptEdits(body, edits);
      revisions = [...result.revisions, ...scripted.revisions];
      for (const item of analysis.items) for (const id of item.revisionIds) itemOf.set(id, item.id);
      for (const block of scripted.blocks) for (const [id, { itemId }] of revisionTexts(block.current)) itemOf.set(id, itemId);
    });

    /** Each item's decision (by its place among the items, the new ones last) for all its revisions. */
    const byEditedItem = <D extends FinalDecision>(decision: (itemId: string, index: number) => D) => {
      const itemIds = [...new Set([...analysis.items.map((item) => item.id), ...scripted.createdItemIds])];
      const index = new Map(itemIds.map((id, i) => [id, i]));
      return new Map(revisions.map((revision) => [revision.id, decision(itemOf.get(revision.id)!, index.get(itemOf.get(revision.id)!)!)]));
    };
    const exportEdited = async (decisions: Map<string, FinalDecision>, name: string, options?: ExportOptions) => {
      const start = performance.now();
      const exported = await exportDocx(result.redline, revisions, decisions, { ...options, edits: scripted.patches });
      const ms = Math.round(performance.now() - start);
      if (process.env.EXPORT_DIR) {
        mkdirSync(process.env.EXPORT_DIR, { recursive: true });
        writeFileSync(join(process.env.EXPORT_DIR, `sample-edits-${name}.docx`), exported);
      }
      return { exported, ms };
    };

    it('reports at compare time the paragraphs the export’s patch refuses', () => {
      const refused = [...paragraphs].filter(([, paragraph]) => paragraph.unpatchable).map(([key]) => key.split(':')[1]);
      expect(Object.keys(result.uneditableBlocks).sort()).toEqual(refused.sort());
      console.log(`sample pair: ${refused.length} paragraphs the patch refuses, found in ${result.timings.editable} ms`);
    });

    it('renders every paragraph block with its own segments as it was, and the edited blocks as markup that reads as their segments', () => {
      for (const block of body.querySelectorAll<HTMLElement>(':is(p, h1, h2, h3, h4, h5, h6)[data-anchor]')) {
        expect(renderBlockSegments(block, readBlockSegments(block)).outerHTML).toBe(block.outerHTML);
      }
      for (const edit of scripted.blocks) {
        const block = body.querySelector(`[data-anchor="${edit.unid}"]`)!;
        expect(readBlockSegments(renderBlockSegments(block, edit.current)), edit.unid).toEqual(edit.current);
      }
    });

    it('updates the live review state for each edit as the scripted edits give it (timings logged, jsdom)', () => {
      const prepared = prepareRenderedDocument(result.html, (parsed) => analyzeComparison(result, () => parsed), (html) => new JSDOM(html).window.document);
      const file = new File([], 'sample.docx');
      const session = new EditSession({
        original: file,
        edited: file,
        originalName: file.name,
        editedName: file.name,
        result: { ...result, redline: new ArrayBuffer(0) },
        ...prepared,
        timings: { worker: 0, prepare: 0 },
      });
      const { index, suggestedEndPoint } = prepared.analysis;
      const wrapper = prepared.document.body.ownerDocument.createElement('div');
      wrapper.append(...[...prepared.document.body.childNodes].map((node) => node.cloneNode(true)));
      const panel = prepareResolvedPanel(wrapper);
      const positions = blockPositions(index, suggestedEndPoint);
      const sidesOf = (items: typeof session.items) => {
        const range = classify(items, session.index, suggestedEndPoint, positions);
        const ignored = ignoredItems(items, session.itemTexts, DEFAULT_COMPARE_SETTINGS);
        return { range, ignored, sides: resolvedItemDecisions(items, INITIAL_DECISIONS, range, ignored) };
      };
      let applied = sidesOf(session.items).sides;
      applyResolution(panel, applied);

      const timings: Record<string, string> = {};
      for (const edit of edits) {
        const after = edit.change(visibleText(session.blocks.get(edit.unid)?.current ?? readBlockSegments(prepared.document.body.querySelector(`[data-anchor="${edit.unid}"]`)!)));
        let start = performance.now();
        const update = session.update(edit.unid, after, edit.caret?.(after))!;
        const sessionMs = performance.now() - start;
        start = performance.now();
        const { range, ignored, sides } = sidesOf(session.items);
        reviewableItems(session.items, range, ignored);
        const memosMs = performance.now() - start;
        start = performance.now();
        const old = wrapper.querySelector<HTMLElement>(`[data-anchor="${edit.unid}"]`)!;
        replaceResolvedBlock(panel, old, update.block.cloneNode(true) as HTMLElement);
        // As the panel does: the items whose side changed (`DocumentPanel`).
        const changed = [...new Set([...applied.keys(), ...sides.keys()])].filter((id) => (applied.get(id) ?? 'accept') !== (sides.get(id) ?? 'accept'));
        applyResolution(panel, sides, [...new Set([...changed, ...update.addedItemIds])]);
        applied = sides;
        const panelMs = performance.now() - start;
        timings[edit.label] = `${Math.round(sessionMs + memosMs + panelMs)} (session ${Math.round(sessionMs)}, memos ${Math.round(memosMs)}, Resolved column ${Math.round(panelMs)})`;

        const expected = scripted.blocks.find((block) => block.unid === edit.unid)!.current;
        expect(session.blocks.get(edit.unid)!.current, edit.label).toEqual(expected);
        expect(readBlockSegments(prepared.document.body.querySelector(`[data-anchor="${edit.unid}"]`)!), edit.label).toEqual(expected);
      }
      // The Resolved column after the updates is the one built from the updated document (a block
      // it joins into the next one can't be read on its own).
      const fresh = prepared.document.body.ownerDocument.createElement('div');
      fresh.append(...[...prepared.document.body.childNodes].map((node) => node.cloneNode(true)));
      const freshPanel = prepareResolvedPanel(fresh);
      applyResolution(freshPanel, sidesOf(session.items).sides);
      expect(wrapper.innerHTML).toBe(fresh.innerHTML);
      expect(session.patches()).toEqual(scripted.patches);
      expect(new Set(session.revisions().map((revision) => revision.id))).toEqual(new Set(revisions.map((revision) => revision.id)));
      console.log('sample pair, one inline-edit update (ms, jsdom):', timings);
    });

    it('accept all, reject all and alternating decisions give the text the segments imply', async () => {
      for (const [label, decisions] of [
        ['accept-all', byEditedItem(() => 'accept')],
        ['reject-all', byEditedItem(() => 'reject')],
        ['alternating-from-accept', byEditedItem((_id, i) => (i % 2 === 0 ? 'accept' : 'reject'))],
        ['alternating-from-reject', byEditedItem((_id, i) => (i % 2 === 0 ? 'reject' : 'accept'))],
      ] as const) {
        const { exported, ms } = await exportEdited(decisions, label);
        console.log(`sample pair export with ${scripted.patches.length} edited paragraphs, ${label}: ${ms} ms`);
        const text = docxText(exported);
        expect(text, label).toEqual(expectedText(result.redline, result.revisions, decisions, editedOverrides(scripted, paragraphs, decisions)));
        if (label === 'reject-all') expect(text).toEqual(docxText(readSamples().original));
        if (label === 'accept-all') expect(text).not.toEqual(docxText(readSamples().edited));
        await expectDeliverable(exported, readSamples().original);
      }
    });

    it('keeps an undecided edited item as a tracked change (FR-38b): resolving it in Word gives the export deciding it so', async () => {
      // The insertion edited inside, and every new item.
      const insideEdit = scripted.blocks.flatMap((block) => block.current).find((segment) => segment.kind === 'ins' && !scripted.createdItemIds.includes(segment.itemId));
      const tracked = new Set([...scripted.createdItemIds, (insideEdit as { itemId: string }).itemId]);
      const withTracked = (decision: FinalDecision) => byEditedItem((id) => (tracked.has(id) ? decision : 'accept'));
      const { exported } = await exportEdited(withTracked('track'), 'tracked', { author: 'Reviewer' });
      expect((await listRevisions(exported)).length).toBeGreaterThan(0);
      for (const [resolve, decision] of [
        [acceptAll, 'accept'],
        [docxDiffRejectRevisions, 'reject'],
      ] as const) {
        const { exported: expected } = await exportEdited(withTracked(decision), `tracked-${decision}`);
        expect(docxText(reconcileNotes(await resolve(exported), exported)), decision).toEqual(docxText(expected));
      }
      await expectTrackedDeliverable(exported, readSamples().original, result.redline);
    });
  });

  describe('Resolved column', () => {
    it('shows the text the export gives, with the detected range and without one', async () => {
      const { analysis: prepared, document, itemTexts } = prepareRenderedDocument(
        result.html,
        (parsed) => analyzeComparison(result, () => parsed),
        (html) => new JSDOM(html).window.document,
      );
      const { items, index, suggestedEndPoint } = prepared;
      const ignored = ignoredItems(items, itemTexts, DEFAULT_COMPARE_SETTINGS);
      const wrapper = document.body.ownerDocument.createElement('div');
      wrapper.append(...[...document.body.childNodes].map((node) => node.cloneNode(true)));
      const panel = prepareResolvedPanel(wrapper);
      const positions = blockPositions(index, suggestedEndPoint);
      let applied: ReadonlyMap<string, 'accept' | 'reject'> | null = null;
      const timings: Record<string, number> = {};
      for (const endPoint of [suggestedEndPoint, null]) {
        const range = classify(items, index, endPoint, positions);
        const outOfRange = new Set(items.filter((item) => range.get(item.id) === 'outOfRange').map((item) => item.id));
        applyRangeOrder(panel, positions, endPoint, outOfRange);
        for (const [label, state] of parityStates(reviewableItems(items, range, ignored))) {
          const sides = resolvedItemDecisions(items, state, range, ignored);
          const start = performance.now();
          applyResolution(panel, sides, applied ? items.map((item) => item.id).filter((id) => applied!.get(id) !== sides.get(id)) : undefined);
          timings[`${applied ? 'to' : 'first,'} ${label}, end point ${endPoint}`] = Math.round(performance.now() - start);
          applied = sides;
          const final = finalRevisionDecisions(items, state, range, 'accept', ignored);
          const exported = await exportDocx(result.redline, result.revisions, final, {
            formattingChoice: 'edited',
            outOfRange: new Set(items.filter((item) => outOfRange.has(item.id)).flatMap((item) => item.revisionIds)),
          });
          expect(resolvedText(wrapper), `${label}, end point ${endPoint}`).toEqual(docxText(exported));
        }
      }

      // One decision flipped, and back.
      const item = reviewableItems(items, new Map(), ignored).find((x) => x.kind === 'deleted')!;
      const flipped = new Map(applied).set(item.id, applied!.get(item.id) === 'accept' ? 'reject' : 'accept');
      let start = performance.now();
      applyResolution(panel, flipped, [item.id]);
      const flipMs = performance.now() - start;
      start = performance.now();
      applyResolution(panel, applied!, [item.id]);
      timings['one decision'] = Math.round(flipMs);
      timings['and back'] = Math.round(performance.now() - start);
      console.log('sample pair Resolved column, applyResolution (ms, jsdom):', timings);
    });
  });

  it('analyzes the worker result on the main thread quickly', () => {
    console.log('sample pair analysis timings (ms, jsdom):', analysis.timings);
    expect(analysis.timings.items).toBeLessThan(200);
  });
});
