// Rendering checks on every synthetic fixture pair (PRD §7.8 item 3): every content, move and
// paragraph-mark revision is in the HTML with its id, and every item has an element in the
// panels. Export round trips on the fixtures are in src/engine/exportDocx.test.ts.
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { beforeAll, describe, expect, it } from 'vitest';
import { runCompare, type ComparePipelineResult } from '../src/engine/pipeline';
import { analyzeComparison, type Analysis } from '../src/model/analyze';
import { decorateDocument, parseRenderedHtml } from '../src/ui/renderedDocument';
import { FIXTURES, FIXTURES_DIR } from './fixtures/make-fixtures';
import { initNodeEngine } from './node-engine';

const parse = (html: string) => new JSDOM(html).window.document;

beforeAll(async () => {
  await initNodeEngine();
});

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
});
