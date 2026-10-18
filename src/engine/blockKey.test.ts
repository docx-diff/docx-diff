import { readFileSync } from 'node:fs';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { beforeAll, describe, expect, it } from 'vitest';
import { unmappedBlocks } from '../../test/block-mapping';
import { FIXTURES, FIXTURES_DIR } from '../../test/fixtures/make-fixtures';
import { minimalDocx } from '../../test/minimal-docx';
import { initNodeEngine } from '../../test/node-engine';
import { paragraphUnids } from './blockKey';
import { W_NS, parseXml } from './ooxml';
import { runCompare } from './pipeline';

beforeAll(async () => {
  await initNodeEngine();
});

/** A package with the given body XML (and the styles of `minimalDocx`). */
function bodyDocx(body: string): Uint8Array {
  const files = unzipSync(minimalDocx([{ heading: 1, text: 'x' }]));
  files['word/document.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W_NS}"><w:body>${body}<w:sectPr/></w:body></w:document>`);
  return zipSync(files);
}

const t = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const p = (content: string, pPr = '') => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${content}</w:p>`;
const cell = (content: string) => `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr>${content}</w:tc>`;

describe('paragraphUnids', () => {
  it.each(FIXTURES.map((fixture) => fixture.name))('maps every paragraph block of fixture %s', async (name) => {
    const read = (side: string) => new Uint8Array(readFileSync(`${FIXTURES_DIR}/${name}.${side}.docx`));
    const result = await runCompare(read('original'), read('edited'));
    const { checked, unmapped } = await unmappedBlocks(result.redline, result.html);
    expect(checked).toBeGreaterThan(0);
    expect(unmapped).toEqual([]);
  });

  it('maps repeated and empty paragraphs, identical table cells, headings and inline objects', async () => {
    const same = 'The same sentence, which the document repeats word for word several times.';
    const document = (word: string) =>
      bodyDocx(
        [
          p(t('A heading')),
          p(t(same)),
          p(''),
          p(t(same)),
          p(''),
          p(t(`A paragraph with a ${word} and a tab`) + '<w:r><w:tab/></w:r>' + t('and a break') + '<w:r><w:br/></w:r>' + t('after it.')),
          p(t(same), '<w:pStyle w:val="Heading1"/>'),
          `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>${[1, 2]
            .map(() => `<w:tr>${cell(p(t(same)))}${cell(p(t(`${word} cell`)) + p(''))}</w:tr>`)
            .join('')}</w:tbl>`,
          p(t(same)),
        ].join(''),
      );
    const result = await runCompare(document('cat'), document('dog'));
    const { checked, unmapped } = await unmappedBlocks(result.redline, result.html);
    expect(checked).toBe(14);
    expect(unmapped).toEqual([]);
  });

  it('finds every w:p of the part, nested ones included', async () => {
    const part = parseXml(
      `<w:document xmlns:w="${W_NS}"><w:body>${p(t('a'))}${p(t('a'))}<w:tbl><w:tr>${cell(p(t('a')) + p(t('b')))}</w:tr></w:tbl></w:body></w:document>`,
    );
    const unids = await paragraphUnids(part);
    expect(unids.size).toBe(4);
    expect([...unids.keys()].every((unid) => /^[0-9a-f]{32}$/.test(unid))).toBe(true);
  });
});
