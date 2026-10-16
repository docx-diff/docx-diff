// Timing check on the synthetic ~300-page pair. Slow (~1 min), so it runs only with BIG_PAIR=1:
//   BIG_PAIR=1 npx vitest run test/big-pair.test.ts
import { JSDOM } from 'jsdom';
import { beforeAll, describe, expect, it } from 'vitest';
import { exportDocx } from '../src/engine/exportDocx';
import { runCompare, type ComparePipelineResult } from '../src/engine/pipeline';
import { rejectRevisions } from '../src/engine/rejectRewrite';
import { analyzeComparison, type Analysis } from '../src/model/analyze';
import { bigPair } from './big-pair';
import { expectedText } from './expectedText';
import { initNodeEngine } from './node-engine';
import { docxText } from './text';

describe.skipIf(!process.env.BIG_PAIR)('~300-page pair', () => {
  let pair: ReturnType<typeof bigPair>;
  let result: ComparePipelineResult;
  let analysis: Analysis;

  beforeAll(async () => {
    await initNodeEngine();
    pair = bigPair();
    result = await runCompare(pair.original, pair.edited);
    analysis = analyzeComparison(result, (html) => new JSDOM(html).window.document);
  }, 120_000);

  it('compares, renders and analyzes', () => {
    console.log({
      words: pair.words,
      revisions: result.revisions.length,
      htmlBytes: result.html.length,
      items: analysis.items.length,
      engineMs: result.timings,
      analysisMs: analysis.timings,
    });
    expect(analysis.items.flatMap((item) => item.revisionIds)).toHaveLength(result.revisions.length);
  });

  it('exports in under 10 s (FR-44): all accepted, all rejected, alternating per item', async () => {
    type Decision = 'accept' | 'reject';
    const byItem = (decision: (index: number) => Decision) => {
      const decisions = new Map<string, Decision>();
      analysis.items.forEach((item, index) => item.revisionIds.forEach((id) => decisions.set(id, decision(index))));
      return decisions;
    };
    const cases: [string, Map<string, Decision>, string[] | null][] = [
      ['all accepted', byItem(() => 'accept'), docxText(pair.edited)],
      ['all rejected', byItem(() => 'reject'), docxText(pair.original)],
      ['alternating', byItem((index) => (index % 2 === 0 ? 'accept' : 'reject')), null],
    ];
    for (const [name, decisions, expected] of cases) {
      const rejected = new Set([...decisions].filter(([, d]) => d === 'reject').map(([id]) => id));
      let start = performance.now();
      rejectRevisions(result.redline, result.revisions, rejected);
      const rewriteMs = Math.round(performance.now() - start);
      start = performance.now();
      const exported = await exportDocx(result.redline, result.revisions, decisions);
      const totalMs = Math.round(performance.now() - start);
      console.log(`~300-page export, ${name}: ${totalMs} ms (of which reject rewrite ${rewriteMs} ms)`);
      expect(docxText(exported)).toEqual(expected ?? expectedText(result.redline, result.revisions, decisions));
      expect(totalMs).toBeLessThan(10_000);
    }
  }, 120_000);
});
