import { beforeAll, describe, expect, it } from 'vitest';
import { initNodeEngine } from './node-engine';
import { minimalDocx } from './minimal-docx';
import { describeWithSamples, readSamples } from './samples';

let engine: Awaited<ReturnType<typeof initNodeEngine>>;

beforeAll(async () => {
  engine = await initNodeEngine();
});

describe('Docxodus under Node', () => {
  it('reports its version', () => {
    expect(engine.getVersion().library).toBeTruthy();
  });

  it('compares two tiny documents', async () => {
    const original = minimalDocx(['The quick brown fox.', 'Second paragraph.']);
    const edited = minimalDocx(['The quick red fox.', 'Second paragraph.']);
    const redline = await engine.docxDiffCompare(original, edited);
    const revisions = await engine.getRevisions(redline);
    const texts = revisions.map((r) => r.text);
    expect(texts).toContain('brown');
    expect(texts).toContain('red');
  });
});

describeWithSamples('sample documents', () => {
  it('can be read', () => {
    const { original, edited } = readSamples();
    expect(original.length).toBeGreaterThan(0);
    expect(edited.length).toBeGreaterThan(0);
  });
});
