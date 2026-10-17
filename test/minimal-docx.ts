// Builds a minimal valid .docx in memory from a list of paragraph texts.
import { strToU8, zipSync } from 'fflate';

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const STYLES_CONTENT_TYPE = `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>`;

const DOCUMENT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

/** Heading 1–6: the HTML converter renders a paragraph as `h<n>` only through its style's outline level. */
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${[1, 2, 3, 4, 5, 6]
  .map((n) => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:pPr><w:outlineLvl w:val="${n - 1}"/></w:pPr></w:style>`)
  .join('')}</w:styles>`;

/** A paragraph's text, or a heading's text and level (1–6). */
export type MinimalParagraph = string | { heading: number; text: string };

/** Without headings the package has no styles part. */
export function minimalDocx(paragraphs: MinimalParagraph[]): Uint8Array {
  const body = paragraphs
    .map((paragraph) => {
      const { text, pPr } =
        typeof paragraph === 'string'
          ? { text: paragraph, pPr: '' }
          : { text: paragraph.text, pPr: `<w:pPr><w:pStyle w:val="Heading${paragraph.heading}"/></w:pPr>` };
      return `<w:p>${pPr}<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
    })
    .join('');
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`;
  const styled = paragraphs.some((paragraph) => typeof paragraph !== 'string');
  return zipSync({
    '[Content_Types].xml': strToU8(styled ? CONTENT_TYPES.replace('</Types>', `  ${STYLES_CONTENT_TYPE}\n</Types>`) : CONTENT_TYPES),
    '_rels/.rels': strToU8(ROOT_RELS),
    'word/document.xml': strToU8(document),
    ...(styled && { 'word/_rels/document.xml.rels': strToU8(DOCUMENT_RELS), 'word/styles.xml': strToU8(STYLES) }),
  });
}
