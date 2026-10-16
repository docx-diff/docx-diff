import { strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { ElementIndex, W_NS, parseConstituentKey, parseXml, serializeXml } from './ooxml';
import { planRangeOrder } from './rangeOrder';
import { rejectElement } from './rejectRewrite';
import type { RevisionListEntry } from './types';

interface TestRevision {
  id: string;
  /** Constituent keys as `kind:localName:w:id`, e.g. `Content:del:1` or `ParaMark:ins:2`. */
  keys: string[];
  decision: 'accept' | 'reject';
  outside?: boolean;
}

function revision({ id, keys }: TestRevision): RevisionListEntry {
  return {
    id,
    type: 'delete',
    family: 'test',
    constituentKeys: keys.map((key) => {
      const [kind, localName, wId] = key.split(':');
      return `kind=${kind}:${W_NS}:${localName}:${wId}`;
    }),
    text: '',
    partUri: '/word/document.xml',
    scope: 'body',
    affectedAnchors: [],
    resolutionStatus: 'supported',
  };
}

/** Plans, rejects the rejected revisions' markup, applies the plan; returns the body XML. */
function exportBody(body: string, revisions: TestRevision[]): string {
  const document = parseXml(`<w:document xmlns:w="${W_NS}"><w:body>${body}</w:body></w:document>`);
  const entries = revisions.map(revision);
  const decisions = new Map(revisions.map((r) => [r.id, r.decision]));
  const apply = planRangeOrder(document, entries, decisions, new Set(revisions.filter((r) => r.outside).map((r) => r.id)));
  const index = new ElementIndex(document);
  const targets = entries
    .filter((entry) => decisions.get(entry.id) === 'reject')
    .flatMap((entry) => entry.constituentKeys.map((key) => ({ element: index.find(parseConstituentKey(key))!, entry })));
  for (const { element, entry } of targets) rejectElement(element, entry);
  apply();
  const xml = strFromU8(serializeXml(document));
  return xml.slice(xml.indexOf('<w:body>') + 8, xml.lastIndexOf('</w:body>')).replace(/ xmlns:w="[^"]*"/g, '').replace(/ w:author="X"/g, '');
}

const run = (text: string) => `<w:r><w:t>${text}</w:t></w:r>`;
const delRun = (text: string) => `<w:r><w:delText>${text}</w:delText></w:r>`;
const para = (content: string, mark = '') => `<w:p>${mark ? `<w:pPr><w:rPr>${mark}</w:rPr></w:pPr>` : ''}${content}</w:p>`;
const SECT = '<w:sectPr/>';

// Kept text, then a deleted tail (outside the range), then a move's destination with an inserted
// mark (in range, the mark from an outside revision), then an inserted closing note (outside).
const BODY =
  para(run('Kept')) +
  para(`<w:del w:id="1" w:author="X">${delRun('Tail')}</w:del>`) +
  para(run('Unchanged tail')) +
  para(`<w:moveTo w:id="3" w:author="X">${run('Moved')}</w:moveTo>`, '<w:ins w:id="4" w:author="X"/>') +
  para(`<w:ins w:id="5" w:author="X">${run('Note')}</w:ins>`, '<w:ins w:id="6" w:author="X"/>') +
  SECT;
const tail: TestRevision = { id: 'tail', keys: ['Content:del:1'], decision: 'reject', outside: true };
const marks: TestRevision = { id: 'mark', keys: ['ParaMark:ins:4'], decision: 'reject', outside: true };
const note: TestRevision = { id: 'note', keys: ['Content:ins:5', 'ParaMark:ins:6'], decision: 'reject', outside: true };

describe('planRangeOrder', () => {
  it('moves in-range content placed after the outside region before it, keeping its mark when accepted', () => {
    const move: TestRevision = { id: 'move', keys: ['Content:moveTo:3'], decision: 'accept' };
    expect(exportBody(BODY, [tail, move, marks, note])).toBe(
      para(run('Kept')) +
        `<w:p><w:pPr><w:rPr/></w:pPr><w:moveTo w:id="3">${run('Moved')}</w:moveTo></w:p>` +
        para(run('Tail')) +
        para(run('Unchanged tail')) +
        para(`<w:del w:id="5">${delRun('Note')}</w:del>`, '<w:del w:id="6"/>') +
        SECT,
    );
  });

  it('rejects the mark with its revision when the moved content is rejected', () => {
    const move: TestRevision = { id: 'move', keys: ['Content:moveTo:3'], decision: 'reject' };
    const body = exportBody(BODY, [tail, move, marks, note]);
    expect(body.indexOf('Moved')).toBeLessThan(body.indexOf('Tail'));
    expect(body).toContain('<w:pPr><w:rPr><w:del w:id="4"/></w:rPr></w:pPr><w:del w:id="3">');
  });

  it('leaves the body alone without content after the outside region, or without an outside revision', () => {
    const before = para(`<w:ins w:id="7" w:author="X">${run('New')}</w:ins>`) + para(`<w:del w:id="1" w:author="X">${delRun('Tail')}</w:del>`) + SECT;
    const insertion: TestRevision = { id: 'new', keys: ['Content:ins:7'], decision: 'accept' };
    const unchanged = exportBody(before, [insertion, tail]);
    expect(unchanged.indexOf('New')).toBeLessThan(unchanged.indexOf('Tail'));
    const move: TestRevision = { id: 'move', keys: ['Content:moveTo:3'], decision: 'accept' };
    const inRange = exportBody(BODY, [{ ...tail, outside: false }, move, { ...marks, outside: false }, { ...note, outside: false }]);
    expect(inRange.indexOf('Tail')).toBeLessThan(inRange.indexOf('Moved'));
  });

  it('does not pull an element whose only in-range markup is formatting', () => {
    const body = para(`<w:del w:id="1" w:author="X">${delRun('Tail')}</w:del>`) + para(`<w:r><w:rPr><w:rPrChange w:id="8" w:author="X"><w:rPr/></w:rPrChange></w:rPr><w:t>Styled</w:t></w:r>`) + SECT;
    const format: TestRevision = { id: 'format', keys: ['PropsChange:rPrChange:8'], decision: 'accept' };
    const result = exportBody(body, [tail, format]);
    expect(result.indexOf('Tail')).toBeLessThan(result.indexOf('Styled'));
  });
});
