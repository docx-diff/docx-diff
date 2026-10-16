import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { minimalDocx } from '../../test/minimal-docx';
import { initNodeEngine } from '../../test/node-engine';
import { normalizeDocxText } from './normalizeText';
import { runCompare } from './pipeline';

const documentXml = (bytes: Uint8Array) => strFromU8(unzipSync(bytes)['word/document.xml']!);

describe('normalizeDocxText', () => {
  it('rewrites decomposed text to NFC', () => {
    const decomposed = 'pavāraṇā & <more>';
    const result = normalizeDocxText(minimalDocx([decomposed]));
    const xml = documentXml(result);
    expect(xml).toContain('pavāraṇā &amp; &lt;more&gt;');
    expect(xml).not.toContain('̄');
  });

  it('returns the same bytes when the text is already NFC', () => {
    const bytes = minimalDocx(['pavāraṇā']);
    expect(normalizeDocxText(bytes)).toBe(bytes);
  });
});

describe('compare with normalization', () => {
  it('finds no change between decomposed and precomposed text', async () => {
    await initNodeEngine();
    const result = await runCompare(minimalDocx(['A pava\u0304ran\u0323a\u0304 szertartás.']), minimalDocx(['A pav\u0101ra\u1e47\u0101 szertartás.']));
    expect(result.revisions).toEqual([]);
  });
});
