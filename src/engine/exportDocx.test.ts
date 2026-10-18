// Export round trips on the synthetic fixture pairs (one per markup kind), with the real engine.
// The sample pair's round trips are in test/sample-pair.test.ts, which shares its compare.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { docxDiffRejectRevisions } from 'docxodus/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { expectDeliverable, expectTrackedDeliverable } from '../../test/deliverable';
import { documentLook, lookDifference } from '../../test/look';
import { FIXTURES, FIXTURES_DIR } from '../../test/fixtures/make-fixtures';
import { TEXT_PARTS, engineDecideOne, partsXml, type Decision } from '../../test/engine-decide';
import { initNodeEngine } from '../../test/node-engine';
import { minimalDocx } from '../../test/minimal-docx';
import { docxText } from '../../test/text';
import { acceptAll, compare, listRevisions } from './docxodus';
import type { FormattingChoice } from './consistentLook';
import { exportDocx } from './exportDocx';
import { reconcileNotes } from './notes';
import { UnsupportedRevisionError } from './rejectRewrite';
import type { FinalDecision, RevisionListEntry } from './types';

beforeAll(async () => {
  await initNodeEngine();
});

/** With EXPORT_DIR set, writes the export there (for scripts/check-libreoffice.sh). */
function keep(exported: Uint8Array, name: string): void {
  if (!process.env.EXPORT_DIR) return;
  mkdirSync(process.env.EXPORT_DIR, { recursive: true });
  writeFileSync(join(process.env.EXPORT_DIR, `${name}.docx`), exported);
}

describe.each(FIXTURES.map((fixture) => [fixture.name, fixture.description] as const))('fixture %s (%s)', (name) => {
  const original = new Uint8Array(readFileSync(`${FIXTURES_DIR}/${name}.original.docx`));
  const edited = new Uint8Array(readFileSync(`${FIXTURES_DIR}/${name}.edited.docx`));
  let redline: Uint8Array;
  let revisions: RevisionListEntry[];
  const decisions = (all: Decision, except: Record<string, Decision> = {}) =>
    new Map(revisions.map((revision) => [revision.id, except[revision.id] ?? all]));

  beforeAll(async () => {
    redline = await compare(original, edited);
    revisions = await listRevisions(redline);
  });

  it('has revisions, all supported', () => {
    expect(revisions.length).toBeGreaterThan(0);
    expect(revisions.filter((revision) => revision.resolutionStatus !== 'supported')).toEqual([]);
  });

  it('accepting all gives the Edited text', async () => {
    const exported = await exportDocx(redline, revisions, decisions('accept'));
    keep(exported, `${name}-accept-all`);
    expect(docxText(exported)).toEqual(docxText(edited));
    await expectDeliverable(exported, original);
  });

  it('rejecting all gives the Original text', async () => {
    const exported = await exportDocx(redline, revisions, decisions('reject'));
    keep(exported, `${name}-reject-all`);
    expect(docxText(exported)).toEqual(docxText(original));
    await expectDeliverable(exported, original);
  });

  it('rejecting one revision and accepting the rest reverts exactly that change, as the engine’s own reject does', async () => {
    for (const revision of revisions) {
      const exported = await exportDocx(redline, revisions, decisions('accept', { [revision.id]: 'reject' }));
      const expected = await engineDecideOne(redline, revision.id, 'reject');
      expect(docxText(exported), `${revision.id} (${revision.family})`).toEqual(docxText(expected));
      expect(partsXml(exported), `${revision.id} (${revision.family})`).toEqual(partsXml(expected));
      await expectDeliverable(exported, original);
    }
  });

  it.each(['edited', 'original'] as const)(
    'with alternating text decisions and the %s formatting, keeps the text and uses only that version’s look',
    async (choice: FormattingChoice) => {
      const formatting = choice === 'edited' ? 'accept' : 'reject';
      let text = 0;
      const mixed = new Map(
        revisions.map((revision) => [revision.id, revision.type === 'format' ? formatting : text++ % 2 === 0 ? 'accept' : 'reject'] as const),
      );
      const exported = await exportDocx(redline, revisions, mixed, { formattingChoice: choice, outOfRange: new Set() });
      keep(exported, `${name}-alternating-${choice}-look`);
      const withoutLook = await exportDocx(redline, revisions, mixed);
      expect(docxText(exported)).toEqual(docxText(withoutLook));
      const reference = documentLook(await exportDocx(redline, revisions, decisions(formatting)));
      const none = { runs: [], paragraphs: [], marks: [] };
      expect(lookDifference(documentLook(exported), reference)).toEqual(none);
      // Without the look step, the restyled fixture mixes the two versions' formatting.
      if (name === 'restyle-edit') expect(lookDifference(documentLook(withoutLook), reference)).not.toEqual(none);
      await expectDeliverable(exported, original);
    },
  );

  it.each(['accept', 'reject', 'alternate'] as const)(
    'with a comment on every text revision (%s), keeps the text and anchors every comment once',
    async (mode) => {
      const text = revisions.filter((revision) => revision.type !== 'format');
      if (text.length === 0) return;
      const chosen = new Map(
        revisions.map((revision) => [revision.id, mode === 'alternate' ? (text.indexOf(revision) % 2 === 0 ? 'accept' : 'reject') : mode] as const),
      );
      const comments = text.map((revision, i) => ({ revisionIds: [revision.id], paragraphs: [`Comment ${i}`, '', 'second line'] }));
      const options = { formattingChoice: 'edited' as const, outOfRange: new Set<string>() };
      const relocated: string[][] = [];
      const onCommentsRelocated = (ids: string[][]) => relocated.push(...ids);
      const exported = await exportDocx(redline, revisions, chosen, { ...options, comments, date: '2026-10-17T12:00:00Z', onCommentsRelocated });
      expect(relocated).toEqual([]);
      keep(exported, `${name}-comments-${mode}`);
      expect(docxText(exported)).toEqual(docxText(await exportDocx(redline, revisions, chosen, options)));
      const files = unzipSync(exported);
      const all = Object.entries(files)
        .filter(([path]) => /^word\/[^/]+\.xml$/.test(path) && path !== 'word/comments.xml')
        .map(([, data]) => strFromU8(data))
        .join('');
      const ids = (pattern: RegExp) => [...all.matchAll(pattern)].map((match) => match[1]).sort();
      const expected = comments.map((_, i) => String(i)).sort();
      expect(ids(/<w:commentReference w:id="(\d+)"/g)).toEqual(expected);
      expect(ids(/<w:commentRangeStart w:id="(\d+)"/g)).toEqual(expected);
      expect(ids(/<w:commentRangeEnd w:id="(\d+)"/g)).toEqual(expected);
      const commentsXml = strFromU8(files['word/comments.xml']!);
      expect(commentsXml.match(/<w:comment /g)).toHaveLength(comments.length);
      expect(commentsXml).toContain('<w:t xml:space="preserve">Comment 0</w:t>');
      expect(strFromU8(files['[Content_Types].xml']!)).toContain('/word/comments.xml');
      await expectDeliverable(exported, original);
    },
  );

  it('keeping every text revision tracked: accepting it gives the Edited text, rejecting it the Original’s', async () => {
    const tracked = new Map(revisions.map((revision) => [revision.id, revision.type === 'format' ? 'accept' : 'track'] as const));
    const exported = await exportDocx(redline, revisions, tracked);
    keep(exported, `${name}-tracked`);
    const textRevisions = revisions.filter((revision) => revision.type !== 'format').length;
    expect((await listRevisions(exported)).length > 0).toBe(textRevisions > 0);
    expect(docxText(reconcileNotes(await acceptAll(exported), exported))).toEqual(docxText(edited));
    const formatOnly = new Map(revisions.map((revision) => [revision.id, revision.type === 'format' ? 'accept' : 'reject'] as const));
    expect(docxText(reconcileNotes(await docxDiffRejectRevisions(exported), exported))).toEqual(
      docxText(await exportDocx(redline, revisions, formatOnly)),
    );
    await expectTrackedDeliverable(exported, original, redline);
  });

  it.each(['accept', 'reject'] as const)(
    'keeping one revision tracked and deciding the rest (%s): accepting or rejecting it there gives that decision’s export',
    async (rest) => {
      for (const revision of revisions.filter((candidate) => candidate.type !== 'format')) {
        const label = `${revision.id} (${revision.family})`;
        const exported = await exportDocx(redline, revisions, decisions(rest, { [revision.id]: 'track' as Decision }));
        for (const [resolve, decision] of [
          [acceptAll, 'accept'],
          [docxDiffRejectRevisions, 'reject'],
        ] as const) {
          const expected = await exportDocx(redline, revisions, decisions(rest, { [revision.id]: decision }));
          expect(docxText(reconcileNotes(await resolve(exported), exported)), `${label} ${decision}`).toEqual(docxText(expected));
        }
        await expectTrackedDeliverable(exported, original, redline);
      }
    },
  );

  it('gives the tracked changes and the comments the export’s author and date', async () => {
    const text = revisions.filter((revision) => revision.type !== 'format');
    if (text.length === 0) return;
    const tracked = new Map<string, FinalDecision>(revisions.map((revision) => [revision.id, revision.type === 'format' ? 'accept' : 'track']));
    const comments = [{ revisionIds: [text[0]!.id], paragraphs: ['Undecided:'] }];
    const exported = await exportDocx(redline, revisions, tracked, { comments, author: 'Ann  Bee Example', date: '2026-10-18T09:00:00Z' });
    const files = unzipSync(exported);
    const xml = TEXT_PARTS.concat('word/comments.xml').map((part) => (files[part] ? strFromU8(files[part]) : '')).join('');
    expect(new Set([...xml.matchAll(/w:author="([^"]*)"/g)].map((match) => match[1]))).toEqual(new Set(['Ann  Bee Example']));
    expect(new Set([...xml.matchAll(/<w:(?:ins|del|moveFrom|moveTo|comment)\b[^>]*w:date="([^"]*)"/g)].map((match) => match[1]))).toEqual(
      new Set(['2026-10-18T09:00:00Z']),
    );
    expect(strFromU8(files['word/comments.xml']!)).toContain('w:initials="ABE"');
    // No bookmark of the parking is left.
    expect(xml).not.toContain('_DDK');
  });

  it('accepting one revision and rejecting the rest applies exactly that change, as the engine does', async () => {
    for (const revision of revisions) {
      const exported = await exportDocx(redline, revisions, decisions('reject', { [revision.id]: 'accept' }));
      const expected = await engineDecideOne(redline, revision.id, 'accept');
      expect(docxText(exported), `${revision.id} (${revision.family})`).toEqual(docxText(expected));
      expect(partsXml(exported), `${revision.id} (${revision.family})`).toEqual(partsXml(expected));
      await expectDeliverable(exported, original);
    }
  });
});

describe('exportDocx errors', () => {
  const [first] = FIXTURES;
  const original = new Uint8Array(readFileSync(`${FIXTURES_DIR}/${first!.name}.original.docx`));
  const edited = new Uint8Array(readFileSync(`${FIXTURES_DIR}/${first!.name}.edited.docx`));

  it('requires a decision for every revision', async () => {
    const redline = await compare(original, edited);
    const revisions = await listRevisions(redline);
    await expect(exportDocx(redline, revisions, new Map())).rejects.toThrow(/No decision/);
  });

  it('refuses a revision the engine does not support', async () => {
    const redline = await compare(original, edited);
    const revisions = (await listRevisions(redline)).map((revision, i) => (i === 0 ? { ...revision, resolutionStatus: 'ambiguous' as const } : revision));
    const accept = new Map(revisions.map((revision) => [revision.id, 'accept' as const]));
    await expect(exportDocx(redline, revisions, accept)).rejects.toThrow(UnsupportedRevisionError);
    await expect(exportDocx(redline, revisions, accept)).rejects.toMatchObject({ revisionId: revisions[0]!.id });
  });
});

describe('exportDocx comments', () => {
  /** A minimal package whose first paragraph carries a comment of its own. */
  function withComment(paragraphs: string[]): Uint8Array {
    const files = unzipSync(minimalDocx(paragraphs));
    const w = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
    files['word/document.xml'] = strToU8(
      strFromU8(files['word/document.xml']!).replace(
        /<w:p>(<w:r>.*?<\/w:r>)<\/w:p>/,
        '<w:p><w:commentRangeStart w:id="0"/>$1<w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p>',
      ),
    );
    files['word/comments.xml'] = strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:comments ${w}><w:comment w:id="0" w:author="Author" w:date="2026-01-01T00:00:00Z" w:initials="A"><w:p><w:r><w:annotationRef/></w:r><w:r><w:t>Original note</w:t></w:r></w:p></w:comment></w:comments>`,
    );
    files['word/_rels/document.xml.rels'] = strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/></Relationships>`,
    );
    files['[Content_Types].xml'] = strToU8(
      strFromU8(files['[Content_Types].xml']!).replace(
        '</Types>',
        '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/></Types>',
      ),
    );
    return zipSync(files);
  }

  it('keeps the comments the documents already have and numbers the new ones after them', async () => {
    const original = withComment(['The quick brown fox.', 'Second paragraph.']);
    const edited = withComment(['The quick red fox.', 'Second paragraph.']);
    const redline = await compare(original, edited);
    const revisions = await listRevisions(redline);
    const accept = new Map(revisions.map((revision) => [revision.id, 'accept' as const]));
    const comments = [{ revisionIds: revisions.map((revision) => revision.id), paragraphs: ['Mine'] }];
    const exported = await exportDocx(redline, revisions, accept, { comments });
    expect(docxText(exported)).toEqual(['The quick red fox.', 'Second paragraph.']);
    const files = unzipSync(exported);
    const part = strFromU8(files['word/comments.xml']!);
    const ids = [...part.matchAll(/<w:comment w:id="(\d+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(part).toContain('Original note');
    expect(part).toContain('>Mine<');
    // One relationship and one content type for the part.
    expect(strFromU8(files['word/_rels/document.xml.rels']!).match(/relationships\/comments"/g)).toHaveLength(1);
    expect(strFromU8(files['[Content_Types].xml']!).match(/\/word\/comments\.xml/g)).toHaveLength(1);
    await expectDeliverable(exported, original);
  });
});
