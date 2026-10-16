import { beforeAll, describe, expect, it } from 'vitest';
import { initNodeEngine } from '../../test/node-engine';
import { minimalDocx } from '../../test/minimal-docx';
import { compare, listRevisions } from './docxodus';
import {
  ElementIndex,
  W_NS,
  parseConstituentKey,
  parseXml,
  partPath,
  readPart,
  serializeXml,
  unzipDocx,
  writePart,
  zipDocx,
} from './ooxml';

describe('parseConstituentKey', () => {
  it('parses content, paragraph-mark and property-change keys', () => {
    expect(parseConstituentKey(`kind=Content:${W_NS}:del:2`)).toEqual({
      kind: 'Content',
      namespace: W_NS,
      localName: 'del',
      id: '2',
      moveName: undefined,
    });
    expect(parseConstituentKey(`kind=ParaMark:${W_NS}:ins:793`)).toMatchObject({ kind: 'ParaMark', localName: 'ins', id: '793' });
    expect(parseConstituentKey(`kind=PropsChange:${W_NS}:pPrChange:5646`)).toMatchObject({
      kind: 'PropsChange',
      localName: 'pPrChange',
      id: '5646',
    });
  });

  it('parses move keys, with and without kind= and name=', () => {
    expect(parseConstituentKey(`kind=Content:${W_NS}:moveFrom:1121:name=move1`)).toEqual({
      kind: 'Content',
      namespace: W_NS,
      localName: 'moveFrom',
      id: '1121',
      moveName: 'move1',
    });
    expect(parseConstituentKey(`${W_NS}:moveFromRangeStart:1200:name=move1`)).toEqual({
      kind: undefined,
      namespace: W_NS,
      localName: 'moveFromRangeStart',
      id: '1200',
      moveName: 'move1',
    });
    expect(parseConstituentKey(`${W_NS}:moveToRangeEnd:5631`)).toMatchObject({ localName: 'moveToRangeEnd', id: '5631' });
  });

  it('rejects keys it cannot read', () => {
    expect(() => parseConstituentKey('nonsense')).toThrow(/Unrecognized/);
  });
});

describe('XML helpers', () => {
  const xml = `<w:document xmlns:w="${W_NS}"><w:body><w:p><w:ins w:id="1" w:author="A"><w:r><w:t>new</w:t></w:r></w:ins><w:del w:id="2" w:author="A"><w:r><w:delText>old</w:delText></w:r></w:del></w:p></w:body></w:document>`;

  it('indexes elements by name and w:id', () => {
    const index = new ElementIndex(parseXml(xml));
    expect(index.get(W_NS, 'ins', '1')?.textContent).toBe('new');
    expect(index.get(W_NS, 'del', '2')?.textContent).toBe('old');
    expect(index.get(W_NS, 'del', '1')).toBeUndefined();
    expect(index.find(parseConstituentKey(`kind=Content:${W_NS}:ins:1`))?.localName).toBe('ins');
  });

  it('round-trips XML through serialize/parse', () => {
    const document = parseXml(xml);
    document.getElementsByTagNameNS(W_NS, 'ins')[0]?.setAttributeNS(W_NS, 'w:author', 'B');
    const again = parseXml(serializeXml(document));
    expect(again.getElementsByTagNameNS(W_NS, 'ins')[0]?.getAttributeNS(W_NS, 'author')).toBe('B');
  });

  it('throws on malformed XML', () => {
    expect(() => parseXml('<a><b></a>')).toThrow();
  });

  it('maps part URIs to zip paths', () => {
    expect(partPath('/word/footnotes.xml')).toBe('word/footnotes.xml');
  });
});

describe('on an engine redline', () => {
  let redline: Uint8Array;

  beforeAll(async () => {
    await initNodeEngine();
    redline = await compare(
      minimalDocx(['The quick brown fox.', 'Second paragraph.']),
      minimalDocx(['The quick red fox.', 'Second paragraph, changed.']),
    );
  });

  it('finds the markup of every constituent key of every revision', async () => {
    const revisions = await listRevisions(redline);
    expect(revisions.length).toBeGreaterThan(0);
    const files = unzipDocx(redline);
    const indexes = new Map<string, ElementIndex>();
    for (const revision of revisions) {
      let index = indexes.get(revision.partUri);
      if (!index) {
        const part = readPart(files, revision.partUri);
        expect(part, revision.partUri).toBeDefined();
        index = new ElementIndex(part!);
        indexes.set(revision.partUri, index);
      }
      for (const key of revision.constituentKeys) {
        expect(index.find(parseConstituentKey(key)), key).toBeDefined();
      }
    }
  });

  it('re-zips a package the engine can still read', async () => {
    const files = unzipDocx(redline);
    const document = readPart(files, '/word/document.xml')!;
    writePart(files, '/word/document.xml', document);
    const revisions = await listRevisions(zipDocx(files));
    expect(revisions.map((r) => r.id)).toEqual((await listRevisions(redline)).map((r) => r.id));
  });
});
