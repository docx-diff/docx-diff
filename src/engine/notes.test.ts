import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { reconcileNotes } from './notes';
import { W_NS } from './ooxml';

const W = `xmlns:w="${W_NS}"`;
const ref = (id: number) => `<w:r><w:footnoteReference w:id="${id}"/></w:r>`;
const note = (id: number, text: string) => `<w:footnote w:id="${id}"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p></w:footnote>`;
const separators = '<w:footnote w:type="separator" w:id="-1"><w:p/></w:footnote><w:footnote w:type="continuationSeparator" w:id="0"><w:p/></w:footnote>';

function docx(paragraphs: string[], notes: string): Uint8Array {
  return zipSync({
    'word/document.xml': strToU8(`<w:document ${W}><w:body>${paragraphs.map((p) => `<w:p>${p}</w:p>`).join('')}</w:body></w:document>`),
    'word/footnotes.xml': strToU8(`<w:footnotes ${W}>${separators}${notes}</w:footnotes>`),
  });
}

const part = (bytes: Uint8Array, name: string) => strFromU8(unzipSync(bytes)[`word/${name}.xml`]!);
const noteIds = (bytes: Uint8Array) => [...part(bytes, 'footnotes').matchAll(/<w:footnote w:id="(\d+)"/g)].map((m) => m[1]);
const referenceIds = (bytes: Uint8Array) => [...part(bytes, 'document').matchAll(/footnoteReference w:id="(\d+)"/g)].map((m) => m[1]);

describe('reconcileNotes', () => {
  it('returns the same bytes when every note is referenced once', () => {
    const exported = docx([ref(1), ref(2)], note(1, 'a') + note(2, 'b'));
    expect(reconcileNotes(exported, exported)).toBe(exported);
  });

  it('gives a second reference to the same note its own copy of the note', () => {
    const redline = docx([ref(1), ref(2)], note(1, 'a') + note(2, 'b'));
    const result = reconcileNotes(docx([ref(1), ref(2), ref(2)], note(1, 'a') + note(2, 'b')), redline);
    expect(referenceIds(result)).toEqual(['1', '2', '3']);
    expect(noteIds(result)).toEqual(['1', '2', '3']);
    expect(part(result, 'footnotes')).toContain('<w:footnote w:id="3"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr><w:r><w:t>b</w:t>');
  });

  it('removes a note whose references the export removed, but keeps notes the redline did not reference', () => {
    const redline = docx([ref(1), ref(2)], note(1, 'a') + note(2, 'b') + note(3, 'orphan already'));
    const result = reconcileNotes(docx([ref(1)], note(1, 'a') + note(2, 'b') + note(3, 'orphan already')), redline);
    expect(noteIds(result)).toEqual(['1', '3']);
    expect(part(result, 'footnotes')).toContain('w:type="separator"');
  });

  it('gives a referenced note without paragraphs a paragraph with its number, with the redline’s style and number formatting', () => {
    const mark = '<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/><w:rPrChange w:id="9"><w:rPr/></w:rPrChange></w:rPr><w:footnoteRef/></w:r>';
    const redline = docx([ref(1)], `<w:footnote w:id="1"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr><w:del w:id="5">${mark}</w:del></w:p></w:footnote>`);
    const result = reconcileNotes(docx([ref(1)], '<w:footnote w:id="1"/>'), redline);
    expect(part(result, 'footnotes')).toContain(
      '<w:footnote w:id="1"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r></w:p></w:footnote>',
    );
  });

  it('gives an empty note a paragraph without a number when the redline note had none', () => {
    const redline = docx([ref(1)], '<w:footnote w:id="1"><w:p/></w:footnote>');
    const result = reconcileNotes(docx([ref(1)], '<w:footnote w:id="1"/>'), redline);
    expect(part(result, 'footnotes')).toContain('<w:footnote w:id="1"><w:p/></w:footnote>');
  });

  it('gives back the number to a referenced note whose paragraph lost it', () => {
    const mark = '<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r>';
    const redline = docx([ref(1)], `<w:footnote w:id="1"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr><w:del w:id="5">${mark}</w:del></w:p></w:footnote>`);
    const exported = docx([ref(1)], '<w:footnote w:id="1"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr></w:p></w:footnote>');
    expect(part(reconcileNotes(exported, redline), 'footnotes')).toContain(`<w:footnote w:id="1"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr>${mark}</w:p></w:footnote>`);
  });

  it('leaves a note without a number alone when the redline note had none either', () => {
    const plain = '<w:footnote w:id="1"><w:p><w:r><w:t>custom mark</w:t></w:r></w:p></w:footnote>';
    const exported = docx([ref(1)], plain);
    expect(reconcileNotes(exported, docx([ref(1)], plain))).toBe(exported);
  });
});
