import { beforeAll, describe, expect, it } from 'vitest';
import { initNodeEngine } from '../../test/node-engine';
import { minimalDocx } from '../../test/minimal-docx';
import { compare, listRevisions, render } from './docxodus';
import { W_NS, parseConstituentKey, readPart, unzipDocx, ElementIndex } from './ooxml';
import { revisionAuthor, revisionIdFromAuthor, tagRedline } from './tagRedline';
import type { RevisionListEntry } from './types';

const moving = 'This paragraph is long enough to be detected as moved rather than deleted and inserted again.';

describe('revision author tags', () => {
  it('round-trips a revision id', () => {
    expect(revisionIdFromAuthor(revisionAuthor('rev2-abc'))).toBe('rev2-abc');
    expect(revisionIdFromAuthor('Docxodus')).toBeNull();
    expect(revisionIdFromAuthor(null)).toBeNull();
  });
});

describe('tagRedline', () => {
  let redline: Uint8Array;
  let revisions: RevisionListEntry[];

  beforeAll(async () => {
    await initNodeEngine();
    redline = await compare(
      minimalDocx(['The quick brown fox.', moving, 'A paragraph that goes away.', 'Middle.', 'End.']),
      minimalDocx(['The quick red fox.', 'Middle.', moving, 'End.']),
    );
    revisions = await listRevisions(redline);
  });

  it('sets w:author to rev:<id> on every markup element that has an author', () => {
    const before = new Uint8Array(redline);
    const tagged = tagRedline(redline, revisions);
    expect(tagged.missingKeys).toEqual([]);
    expect(redline).toEqual(before);

    const index = new ElementIndex(readPart(unzipDocx(tagged.bytes), '/word/document.xml')!);
    let checked = 0;
    for (const revision of revisions) {
      for (const key of revision.constituentKeys) {
        const element = index.find(parseConstituentKey(key))!;
        if (element.hasAttributeNS(W_NS, 'author')) {
          expect(element.getAttributeNS(W_NS, 'author')).toBe(revisionAuthor(revision.id));
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('makes every revision visible in the rendered HTML as data-author', async () => {
    expect(revisions.map((r) => r.family)).toEqual(expect.arrayContaining(['content_insert', 'content_delete', 'move']));
    const html = await render(tagRedline(redline, revisions).bytes);
    for (const revision of revisions.filter((r) => r.type !== 'format')) {
      expect(html, `${revision.family} ${revision.text}`).toContain(`data-author="${revisionAuthor(revision.id)}"`);
    }
    expect(html).not.toContain('data-author="Docxodus"');
  });

  it('reports keys whose markup is missing instead of failing', () => {
    const bogus: RevisionListEntry = { ...revisions[0]!, constituentKeys: [`kind=Content:${W_NS}:ins:999999`] };
    expect(tagRedline(redline, [bogus]).missingKeys).toEqual([`kind=Content:${W_NS}:ins:999999`]);
  });
});
