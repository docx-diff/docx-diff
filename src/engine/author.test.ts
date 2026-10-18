import { strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { minimalDocx } from '../../test/minimal-docx';
import { documentAuthor } from './author';

const CORE = (fields: string) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">${fields}</cp:coreProperties>`;

/** A minimal package with these core properties, and tracked changes by these authors. */
function docx({ core, trackedBy = [] }: { core?: string; trackedBy?: string[] }): Uint8Array {
  const files = unzipSync(minimalDocx(['Text.']));
  const tracked = trackedBy.map((author, i) => `<w:ins w:id="${i}" w:author="${author}" w:date="2026-01-01T00:00:00Z"><w:r><w:t>x</w:t></w:r></w:ins>`).join('');
  files['word/document.xml'] = strToU8(new TextDecoder().decode(files['word/document.xml']).replace('</w:r></w:p>', `</w:r>${tracked}</w:p>`));
  if (core !== undefined) files['docProps/core.xml'] = strToU8(CORE(core));
  return zipSync(files);
}

describe('documentAuthor', () => {
  it('takes the author of most of the tracked changes first', () => {
    const bytes = docx({ core: '<cp:lastModifiedBy>Last</cp:lastModifiedBy>', trackedBy: ['Ann', 'Bo &amp; Co', 'Bo &amp; Co'] });
    expect(documentAuthor(bytes)).toBe('Bo & Co');
  });

  it('then the last author, then the creator', () => {
    expect(documentAuthor(docx({ core: '<dc:creator>Creator</dc:creator><cp:lastModifiedBy> Last </cp:lastModifiedBy>' }))).toBe('Last');
    expect(documentAuthor(docx({ core: '<dc:creator>Creator</dc:creator><cp:lastModifiedBy></cp:lastModifiedBy>' }))).toBe('Creator');
  });

  it('is null when the document names nobody', () => {
    expect(documentAuthor(docx({}))).toBeNull();
    expect(documentAuthor(docx({ core: '<dc:creator/>' }))).toBeNull();
  });
});
