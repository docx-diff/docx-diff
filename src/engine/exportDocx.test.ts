// Export round trips on the synthetic fixture pairs (one per markup kind), with the real engine.
// The sample pair's round trips are in test/sample-pair.test.ts, which shares its compare.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { docxDiffRejectRevisions, openDocxSession } from 'docxodus/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { expectDeliverable } from '../../test/deliverable';
import { FIXTURES, FIXTURES_DIR } from '../../test/fixtures/make-fixtures';
import { initNodeEngine } from '../../test/node-engine';
import { docxText } from '../../test/text';
import { acceptAll, compare, listRevisions } from './docxodus';
import { exportDocx } from './exportDocx';
import { reconcileNotes } from './notes';
import { UnsupportedRevisionError } from './rejectRewrite';
import type { RevisionListEntry } from './types';

type Decision = 'accept' | 'reject';

const TEXT_PARTS = ['word/document.xml', 'word/footnotes.xml', 'word/endnotes.xml'];

/**
 * The text parts' XML, for comparing two exports: namespace declarations, rsids, the space in
 * `<w:b />` (.NET writes one, xmldom doesn't) and empty property containers (`<w:rPr/>` ≡ no
 * `w:rPr`) are left out.
 */
function partsXml(bytes: Uint8Array): string[] {
  const files = unzipSync(bytes, { filter: (file) => TEXT_PARTS.includes(file.name) });
  return TEXT_PARTS.map((part) =>
    files[part]
      ? strFromU8(files[part])
          .replace(/ xmlns:\w+="[^"]*"/g, '')
          .replace(/ w:rsid\w*="[^"]*"/g, '')
          .replace(/ \/>/g, '/>')
          .replace(/<w:(rPr|pPr|trPr|tcPr|tblPrEx)\/>/g, '')
      : '',
  );
}

/**
 * The engine's own way to decide one revision differently from the rest: a session decides it
 * (slow, so only for these tiny documents), then a stateless pass resolves the others. The
 * export's note reconciliation is applied to it too.
 */
async function engineDecideOne(redline: Uint8Array, revisionId: string, decision: Decision): Promise<Uint8Array> {
  const session = openDocxSession(redline);
  try {
    const result = decision === 'reject' ? session.rejectRevision(revisionId) : session.acceptRevision(revisionId);
    if (!result.success) throw new Error(`session ${decision} of ${revisionId} failed: ${JSON.stringify(result.error)}`);
    const decidedOne = session.save();
    const resolved = decision === 'reject' ? await acceptAll(decidedOne) : await docxDiffRejectRevisions(decidedOne);
    return reconcileNotes(resolved, redline);
  } finally {
    session.close();
  }
}

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
