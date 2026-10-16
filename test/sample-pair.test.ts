// Engine and model checks on the sample pair (PRD §7.2, expected numbers in the task list).
// One compare result is shared by the whole file, since a compare takes several seconds.
import { JSDOM } from 'jsdom';
import { beforeAll, describe, expect, it } from 'vitest';
import { compare, listRevisions } from '../src/engine/docxodus';
import { runCompare, type ComparePipelineResult } from '../src/engine/pipeline';
import type { RevisionListEntry } from '../src/engine/types';
import { analyzeComparison, type Analysis } from '../src/model/analyze';
import { isBareParagraphMark } from '../src/model/changes';
import { blockPositions, classify } from '../src/model/range';
import { initNodeEngine } from './node-engine';
import { describeWithSamples, readSamples } from './samples';

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
      expect(analysis.items).toHaveLength(623);
      expect(countBy(analysis.items, (i) => i.kind)).toEqual({
        formatting: 378,
        replaced: 147,
        deleted: 58,
        inserted: 21,
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

    it('has 110 delete→insert and 143 insert→delete neighbours sharing an anchor, paired greedily into 29 + 118 items', () => {
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
      expect(countBy(pairs, (family) => family)).toEqual({ content_delete: 29, content_insert: 118 });
    });

    it('describes formatting items from the HTML titles where the HTML has their elements', () => {
      const formatting = analysis.items.filter((item) => item.kind === 'formatting');
      expect(formatting.filter((item) => item.description)).toHaveLength(355);
      expect(formatting.map((item) => item.description)).toContain('Font size changed, Font changed');
    });

    it('locates footnote items with their note id', () => {
      const notes = analysis.items.filter((item) => item.location.scope === 'footnote');
      // 35 footnote revisions; two pairs are Replaced items.
      expect(notes).toHaveLength(33);
      expect(notes.every((item) => /^\d+$/.test(item.location.noteId ?? ''))).toBe(true);
    });
  });

  describe('document index', () => {
    it('has 775 anchored blocks and 733 Original body paragraphs', () => {
      expect(analysis.index.blocks).toHaveLength(775);
      expect(analysis.index.bodyParagraphs).toHaveLength(733);
      expect(analysis.index.noteRefs.size).toBe(20);
    });

    it('contains every revision anchor except section anchors', () => {
      const anchors = result.revisions.flatMap((r) => r.affectedAnchors);
      const missing = anchors.filter((anchor) => !analysis.index.blockByUnid.has(anchor.unid));
      expect(missing.map((anchor) => anchor.kind)).toEqual(['sec']);
    });

    it('shows every content, move and paragraph-mark revision, and 355 of 378 formatting revisions', () => {
      const shown = (r: RevisionListEntry) => analysis.index.revisionsInHtml.has(r.id);
      expect(result.revisions.filter((r) => r.type !== 'format' && !shown(r))).toEqual([]);
      expect(result.revisions.filter((r) => r.type === 'format' && shown(r))).toHaveLength(355);
    });
  });

  describe('comparison range', () => {
    it('proposes the first paragraph of the tail revision as the end point', () => {
      const tail = result.revisions.reduce((a, b) => (b.text.length > a.text.length ? b : a));
      const tailItem = analysis.items.find((item) => item.revisionIds.includes(tail.id))!;
      expect(analysis.suggestedEndPoint).toBe(154);
      expect(analysis.index.bodyParagraphs[154]).toBe(tail.affectedAnchors[0]!.unid);
      expect(analysis.index.bodyParagraphs.length - 154).toBe(579);

      const classes = classify(analysis.items, analysis.index, analysis.suggestedEndPoint);
      expect(classes.get(tailItem.id)).toBe('outOfRange');
    });

    it('puts the tail, its 15 footnote deletions (notes 6–20) and the items placed after it out of range', () => {
      const classes = classify(analysis.items, analysis.index, analysis.suggestedEndPoint);
      const out = analysis.items.filter((item) => classes.get(item.id) === 'outOfRange');
      const tailNotes = out.filter((item) => item.location.scope === 'footnote');
      expect(tailNotes.map((item) => item.kind)).toEqual(Array(15).fill('deleted'));
      expect(tailNotes.map((item) => Number(item.location.noteId))).toEqual(Array.from({ length: 15 }, (_, i) => i + 6));
      // The two moves carry paragraphs 151–153 from before the tail to after it; the last two items are the
      // Edited document's closing paragraphs, which the engine placed after the deleted tail.
      expect(countBy(out, (item) => `${item.kind}/${item.location.scope}`)).toEqual({
        'deleted/body': 1,
        'deleted/footnote': 15,
        'moved/body': 2,
        'paragraph/body': 1,
        'inserted/body': 1,
      });
      const positions = blockPositions(analysis.index);
      for (const item of out.filter((i) => i.kind === 'moved')) {
        expect(item.anchors.map((unid) => positions.get(unid)!).some((p) => p < 154)).toBe(true);
      }
    });

    it('keeps every item in range without an end point', () => {
      const classes = classify(analysis.items, analysis.index, null);
      expect([...classes.values()].every((c) => c === 'inRange')).toBe(true);
    });
  });

  it('analyzes the worker result on the main thread quickly', () => {
    console.log('sample pair analysis timings (ms, jsdom):', analysis.timings);
    expect(analysis.timings.items).toBeLessThan(200);
  });
});
