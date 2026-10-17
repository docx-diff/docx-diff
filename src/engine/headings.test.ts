import { strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { minimalDocx } from '../../test/minimal-docx';
import { documentHeadings } from './headings';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

/** A minimal package with the given body and paragraph styles. */
function docx(body: string, styles: string): Uint8Array {
  const files = unzipSync(minimalDocx([{ heading: 1, text: 'x' }]));
  files['word/document.xml'] = strToU8(`<w:document ${W}><w:body>${body}<w:sectPr/></w:body></w:document>`);
  files['word/styles.xml'] = strToU8(`<w:styles ${W}>${styles}</w:styles>`);
  return zipSync(files);
}

const style = (id: string, inner: string, attributes = '') => `<w:style w:type="paragraph" w:styleId="${id}"${attributes}>${inner}</w:style>`;
const para = (pPr: string, runs: string) => `<w:p><w:pPr>${pPr}</w:pPr>${runs}</w:p>`;
const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;

describe('documentHeadings', () => {
  it('reads outline levels from the style, the styles it is based on, or the paragraph itself', () => {
    const styles = [
      style('Normal', '', ' w:default="1"'),
      style('Cim1', '<w:pPr><w:outlineLvl w:val="0"/></w:pPr>'),
      style('Sub', '<w:basedOn w:val="Cim2"/>'),
      style('Cim2', '<w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr>'),
      style('Body', '<w:pPr><w:outlineLvl w:val="9"/></w:pPr>'),
    ].join('');
    const body = [
      para('<w:pStyle w:val="Cim1"/>', run('Title')),
      para('', run('Plain text')),
      para('<w:pStyle w:val="Sub"/>', run('Based on ') + run('level 2')),
      para('<w:outlineLvl w:val="2"/>', run('Direct')),
      para('<w:pStyle w:val="Cim1"/><w:outlineLvl w:val="9"/>', run('Body text after all')),
      para('<w:pStyle w:val="Body"/>', run('Body style')),
      para('<w:pStyle w:val="Cim1"/>', ''),
    ].join('');
    expect(documentHeadings(docx(body, styles))).toEqual([
      { level: 1, text: 'Title' },
      { level: 2, text: 'Based on level 2' },
      { level: 3, text: 'Direct' },
    ]);
  });

  it("takes an input's tracked changes as accepted, and tabs as spaces", () => {
    const styles = style('H', '<w:pPr><w:outlineLvl w:val="0"/></w:pPr>');
    const body = para(
      '<w:pStyle w:val="H"/>',
      `${run('One')}<w:r><w:tab/></w:r><w:del w:id="1" w:author="a"><w:r><w:delText>old</w:delText></w:r></w:del><w:ins w:id="2" w:author="a">${run('two')}</w:ins>`,
    );
    expect(documentHeadings(docx(body, styles))).toEqual([{ level: 1, text: 'One two' }]);
  });

  it('finds none without styles or outline levels', () => {
    expect(documentHeadings(minimalDocx(['Just text']))).toEqual([]);
  });
});
