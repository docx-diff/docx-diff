// Builds the synthetic fixture pairs, one per markup kind the export rewrites, as hand-written
// minimal OOXML. Run after changing a fixture and commit the generated files:
//   node test/fixtures/make-fixtures.ts
// Each pair is written as `<name>.original.docx` and `<name>.edited.docx` next to this script.
// The zip timestamps are fixed, so the same script gives the same bytes.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { strToU8, zipSync } from 'fflate';

export const FIXTURES_DIR = import.meta.dirname;

interface DocSpec {
  /** Body content (paragraphs and tables), without the final `w:sectPr`. */
  body: string;
  /** The body's section properties (default: A4, 2 cm margins). */
  sectPr?: string;
  /** Footnote contents by id (ids from 1; separators are added). */
  footnotes?: Record<number, string>;
  endnotes?: Record<number, string>;
}

export interface FixturePair {
  name: string;
  description: string;
  original: DocSpec;
  edited: DocSpec;
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** A run of text with optional run properties. */
function r(text: string, rPr = ''): string {
  return `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

/** A paragraph of runs (strings become plain runs) with optional paragraph properties. */
function p(content: string | string[], pPr = ''): string {
  const runs = Array.isArray(content) ? content.join('') : r(content);
  return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${runs}</w:p>`;
}

function footnoteRef(id: number): string {
  return `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="${id}"/></w:r>`;
}

function endnoteRef(id: number): string {
  return `<w:r><w:rPr><w:rStyle w:val="EndnoteReference"/></w:rPr><w:endnoteReference w:id="${id}"/></w:r>`;
}

interface TableSpec {
  rows: string[][];
  tblPr?: string;
  grid?: number[];
  /** Row properties per row index. */
  trPr?: Record<number, string>;
  /** Cell properties per `row:column`. */
  tcPr?: Record<string, string>;
}

function table({ rows, tblPr = '', grid, trPr = {}, tcPr = {} }: TableSpec): string {
  const columns = rows[0]!.length;
  const widths = grid ?? Array.from({ length: columns }, () => Math.floor(9000 / columns));
  const borders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="000000"/>`)
    .join('');
  const properties = tblPr || `<w:tblW w:w="0" w:type="auto"/><w:tblBorders>${borders}</w:tblBorders>`;
  const body = rows
    .map((cells, row) => {
      const tcs = cells
        .map((text, column) => {
          const width = `<w:tcW w:w="${widths[column]}" w:type="dxa"/>`;
          return `<w:tc><w:tcPr>${width}${tcPr[`${row}:${column}`] ?? ''}</w:tcPr>${p(text)}</w:tc>`;
        })
        .join('');
      return `<w:tr>${trPr[row] ? `<w:trPr>${trPr[row]}</w:trPr>` : ''}${tcs}</w:tr>`;
    })
    .join('');
  const gridXml = widths.map((width) => `<w:gridCol w:w="${width}"/>`).join('');
  return `<w:tbl><w:tblPr>${properties}</w:tblPr><w:tblGrid>${gridXml}</w:tblGrid>${body}</w:tbl>`;
}

const A4_SECTION =
  '<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="709" w:footer="709" w:gutter="0"/>';

// Text for the fixtures: plain sentences long enough for the engine to match paragraphs.
const LOREM = [
  'The monastery stood at the edge of the forest, where the old road ended and the path began.',
  'Every morning the monks walked to the village in silence to receive their daily alms food.',
  'In the afternoon they swept the paths, drew water from the well and repaired their robes.',
  'The rules of the community were few but strict, and the senior monks enforced them gently.',
  'Visitors who came for a day often stayed for a week, and some of them never left at all.',
  'At night the forest was loud with insects, and the lamps in the huts burned until late.',
];

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

const STYLES = `${XML_DECL}<w:styles ${W}>
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Liberation Serif" w:hAnsi="Liberation Serif"/><w:sz w:val="24"/></w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="FootnoteText"><w:name w:val="footnote text"/><w:basedOn w:val="Normal"/><w:rPr><w:sz w:val="20"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="EndnoteText"><w:name w:val="endnote text"/><w:basedOn w:val="Normal"/><w:rPr><w:sz w:val="20"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="EndnoteReference"><w:name w:val="endnote reference"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>
<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
</w:styles>`;

function notesPart(kind: 'footnote' | 'endnote', notes: Record<number, string>): string {
  const root = kind === 'footnote' ? 'footnotes' : 'endnotes';
  const style = kind === 'footnote' ? 'FootnoteText' : 'EndnoteText';
  const refStyle = kind === 'footnote' ? 'FootnoteReference' : 'EndnoteReference';
  const refElement = kind === 'footnote' ? 'footnoteRef' : 'endnoteRef';
  const separators =
    `<w:${kind} w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:${kind}>` +
    `<w:${kind} w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:${kind}>`;
  const entries = Object.entries(notes)
    .map(
      ([id, text]) =>
        `<w:${kind} w:id="${id}"><w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr>` +
        `<w:r><w:rPr><w:rStyle w:val="${refStyle}"/></w:rPr><w:${refElement}/></w:r>${r(' ' + text)}</w:p></w:${kind}>`,
    )
    .join('');
  return `${XML_DECL}<w:${root} ${W}>${separators}${entries}</w:${root}>`;
}

/** The `.docx` bytes of one document. */
export function buildDocx(spec: DocSpec): Uint8Array {
  const hasFootnotes = spec.footnotes !== undefined;
  const hasEndnotes = spec.endnotes !== undefined;
  const overrides = [
    ['/word/document.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'],
    ['/word/styles.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml'],
    ...(hasFootnotes ? [['/word/footnotes.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml']] : []),
    ...(hasEndnotes ? [['/word/endnotes.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml']] : []),
  ];
  const contentTypes =
    `${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    overrides.map(([part, type]) => `<Override PartName="${part}" ContentType="${type}"/>`).join('') +
    '</Types>';
  const rootRels =
    `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '</Relationships>';
  const relType = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
  const documentRels =
    `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="${relType}styles" Target="styles.xml"/>` +
    (hasFootnotes ? `<Relationship Id="rId2" Type="${relType}footnotes" Target="footnotes.xml"/>` : '') +
    (hasEndnotes ? `<Relationship Id="rId3" Type="${relType}endnotes" Target="endnotes.xml"/>` : '') +
    '</Relationships>';
  const document =
    `${XML_DECL}<w:document ${W} ${R}><w:body>${spec.body}` +
    `<w:sectPr>${spec.sectPr ?? A4_SECTION}</w:sectPr></w:body></w:document>`;

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rootRels),
    'word/_rels/document.xml.rels': strToU8(documentRels),
    'word/document.xml': strToU8(document),
    'word/styles.xml': strToU8(STYLES),
  };
  if (hasFootnotes) files['word/footnotes.xml'] = strToU8(notesPart('footnote', spec.footnotes!));
  if (hasEndnotes) files['word/endnotes.xml'] = strToU8(notesPart('endnote', spec.endnotes!));
  return zipSync(files, { mtime: new Date(2026, 0, 1) });
}

const body = (...blocks: string[]) => blocks.join('');
const [L0, L1, L2, L3, L4, L5] = LOREM as [string, string, string, string, string, string];

export const FIXTURES: FixturePair[] = [
  {
    name: 'insert',
    description: 'words inserted in a paragraph, and a new paragraph',
    original: { body: body(p(L0), p(L1), p(L2)) },
    edited: {
      body: body(
        p(L0.replace('the old road', 'the old dusty road')),
        p(L1),
        p('A new paragraph about the bell that called the monks to the evening chanting.'),
        p(L2),
      ),
    },
  },
  {
    name: 'delete',
    description: 'words deleted from a paragraph, and a whole paragraph deleted',
    original: { body: body(p(L0), p(L1), p(L2), p(L3)) },
    edited: { body: body(p(L0.replace(' at the edge of the forest,', '')), p(L1.replace(' in silence', '')), p(L3)) },
  },
  {
    name: 'replace',
    description: 'one word replaced, and a phrase replaced',
    original: { body: body(p(L0), p(L1), p(L2)) },
    edited: {
      body: body(p(L0.replace('forest', 'jungle')), p(L1), p(L2.replace('drew water from the well', 'carried water from the stream'))),
    },
  },
  {
    name: 'format-run',
    description: 'run properties changed: a word made bold, a phrase italic, a font changed',
    original: { body: body(p(L0), p(L1), p(L2)) },
    edited: {
      body: body(
        p([r('The '), r('monastery', '<w:b/>'), r(L0.slice('The monastery'.length))]),
        p([r('Every morning the monks walked '), r('to the village', '<w:i/>'), r(' in silence to receive their daily alms food.')]),
        p([r(L2, '<w:rFonts w:ascii="Liberation Sans" w:hAnsi="Liberation Sans"/>')]),
      ),
    },
  },
  {
    name: 'format-paragraph',
    description: 'paragraph properties changed: alignment, style, spacing (with a run property on the paragraph mark)',
    original: { body: body(p('The Daily Routine'), p(L0), p([r(L1)], '<w:rPr><w:b/></w:rPr>')) },
    edited: {
      body: body(
        p('The Daily Routine', '<w:pStyle w:val="Heading1"/>'),
        p(L0, '<w:jc w:val="center"/>'),
        p([r(L1)], '<w:spacing w:before="240" w:after="240"/><w:rPr><w:b/></w:rPr>'),
      ),
    },
  },
  {
    name: 'section',
    description: 'section properties changed: page orientation and margins',
    original: { body: body(p(L0), p(L1)) },
    edited: {
      body: body(p(L0), p(L1)),
      sectPr:
        '<w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="709" w:footer="709" w:gutter="0"/>',
    },
  },
  {
    name: 'move',
    description: 'a paragraph moved to a later position',
    original: { body: body(p(L0), p(L1), p(L2), p(L3), p(L4), p(L5)) },
    edited: { body: body(p(L0), p(L2), p(L3), p(L4), p(L1), p(L5)) },
  },
  {
    name: 'paragraph-split',
    description: 'a paragraph split in two, and an empty paragraph inserted',
    original: { body: body(p(`${L0} ${L1}`), p(L2), p(L3)) },
    edited: { body: body(p(L0), p(L1), p(L2), p(''), p(L3)) },
  },
  {
    name: 'paragraph-join',
    description: 'two paragraphs joined, an empty paragraph removed, and a join with a text change',
    original: { body: body(p(L0), p(L1), p(''), p(L2), p(L3)) },
    edited: { body: body(p(`${L0} ${L1}`), p(`${L2} Then ${L3.charAt(0).toLowerCase()}${L3.slice(1)}`)) },
  },
  {
    name: 'table-cell-edit',
    description: 'text edited inside table cells',
    original: {
      body: body(
        p(L0),
        table({ rows: [['Time', 'Activity'], ['4:00', 'Morning chanting'], ['6:00', 'Alms round in the village']] }),
        p(L1),
      ),
    },
    edited: {
      body: body(
        p(L0),
        table({ rows: [['Time', 'Activity'], ['3:30', 'Morning chanting and meditation'], ['6:00', 'Alms round']] }),
        p(L1),
      ),
    },
  },
  {
    name: 'table-rows',
    description: 'a table row inserted and another deleted',
    original: {
      body: body(
        p(L0),
        table({ rows: [['Time', 'Activity'], ['4:00', 'Morning chanting'], ['6:00', 'Alms round'], ['8:00', 'Meal'], ['15:00', 'Sweeping']] }),
        p(L1),
      ),
    },
    edited: {
      body: body(
        p(L0),
        table({ rows: [['Time', 'Activity'], ['4:00', 'Morning chanting'], ['5:00', 'Meditation'], ['6:00', 'Alms round'], ['15:00', 'Sweeping']] }),
        p(L1),
      ),
    },
  },
  {
    name: 'table-restyle',
    description: 'table, row and cell properties and column widths changed, text unchanged',
    original: {
      body: body(p(L0), table({ rows: [['Time', 'Activity'], ['4:00', 'Morning chanting'], ['6:00', 'Alms round']], grid: [2000, 7000] }), p(L1)),
    },
    edited: {
      body: body(
        p(L0),
        table({
          rows: [['Time', 'Activity'], ['4:00', 'Morning chanting'], ['6:00', 'Alms round']],
          grid: [3000, 6000],
          tblPr:
            '<w:tblW w:w="5000" w:type="pct"/><w:jc w:val="center"/><w:tblBorders>' +
            ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
              .map((side) => `<w:${side} w:val="double" w:sz="6" w:space="0" w:color="336699"/>`)
              .join('') +
            '</w:tblBorders>',
          trPr: { 0: '<w:tblHeader/>', 1: '<w:trHeight w:val="567"/>' },
          tcPr: { '0:0': '<w:shd w:val="clear" w:color="auto" w:fill="DDEEFF"/>', '0:1': '<w:shd w:val="clear" w:color="auto" w:fill="DDEEFF"/>', '2:1': '<w:vAlign w:val="center"/>' },
        }),
        p(L1),
      ),
    },
  },
  {
    name: 'footnote-edit',
    description: 'footnote text edited, a footnote added and one removed',
    original: {
      body: body(p([r(L0), footnoteRef(1)]), p([r(L1), footnoteRef(2)]), p(L2)),
      footnotes: { 1: 'The road was paved only in the nineteen-eighties.', 2: 'Alms food is offered by lay supporters.' },
    },
    edited: {
      body: body(p([r(L0), footnoteRef(1)]), p(L1), p([r(L2), footnoteRef(2)])),
      footnotes: { 1: 'The road was finally paved in the nineteen-nineties.', 2: 'The well was dug by the first abbot.' },
    },
  },
  {
    name: 'endnote-edit',
    description: 'endnote text edited',
    original: {
      body: body(p([r(L0), endnoteRef(1)]), p(L1)),
      endnotes: { 1: 'See the chapter on the forest tradition for the history of the place.' },
    },
    edited: {
      body: body(p([r(L0), endnoteRef(1)]), p(L1)),
      endnotes: { 1: 'See the second chapter for the early history of the place.' },
    },
  },
  {
    name: 'trailing-deletion',
    description: 'only the first part edited; the rest (with a footnote) is missing from the Edited document',
    original: {
      body: body(p(L0), p(L1), p(L2), p([r(L3), footnoteRef(1)]), p(L4), p(L5)),
      footnotes: { 1: 'A note in the unedited part.' },
    },
    edited: { body: body(p(L0.replace('old road', 'old cart road')), p(L1), p(L2.replace('repaired', 'mended'))), footnotes: {} },
  },
];

function writeFixtures(): void {
  for (const fixture of FIXTURES) {
    writeFileSync(resolve(FIXTURES_DIR, `${fixture.name}.original.docx`), buildDocx(fixture.original));
    writeFileSync(resolve(FIXTURES_DIR, `${fixture.name}.edited.docx`), buildDocx(fixture.edited));
  }
  console.log(`Wrote ${FIXTURES.length} fixture pairs to ${FIXTURES_DIR}`);
}

if (import.meta.main) writeFixtures();
