// Timing check on the synthetic ~300-page pair. Slow (~30 s), so it runs only with BIG_PAIR=1:
//   BIG_PAIR=1 npx vitest run test/big-pair.test.ts
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { runCompare } from '../src/engine/pipeline';
import { analyzeComparison } from '../src/model/analyze';
import { bigPair } from './big-pair';
import { initNodeEngine } from './node-engine';

describe.skipIf(!process.env.BIG_PAIR)('~300-page pair', () => {
  it('compares, renders and analyzes', async () => {
    await initNodeEngine();
    const { original, edited, words } = bigPair();
    const result = await runCompare(original, edited);
    const analysis = analyzeComparison(result, (html) => new JSDOM(html).window.document);
    console.log({
      words,
      revisions: result.revisions.length,
      htmlBytes: result.html.length,
      items: analysis.items.length,
      engineMs: result.timings,
      analysisMs: analysis.timings,
    });
    expect(analysis.items.flatMap((item) => item.revisionIds)).toHaveLength(result.revisions.length);
  });
});
