// Checks that `docxText`, the round-trip oracle, reads the samples the way `pandoc -t plain` does.
// Pandoc also prints automatic list labels ("1. "), which are not text runs. A Lua filter moves the
// notes to the end, as `docxText` reads them, instead of pandoc's "[1]" references.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { docxText } from './text';
import { EDITED_SAMPLE, ORIGINAL_SAMPLE, readSamples, samplesAvailable } from './samples';

function hasPandoc(): boolean {
  try {
    execFileSync('pandoc', ['--version']);
    return true;
  } catch {
    return false;
  }
}

const NOTES_LAST = `
local notes = {}
function Note(note)
  for _, block in ipairs(note.content) do table.insert(notes, block) end
  return {}
end
function Pandoc(doc)
  for _, block in ipairs(notes) do doc.blocks:insert(block) end
  return doc
end
`;

function pandocParagraphs(path: string): string[] {
  const dir = mkdtempSync(join(tmpdir(), 'docx-diff-pandoc-'));
  try {
    const filter = join(dir, 'notes-last.lua');
    writeFileSync(filter, NOTES_LAST);
    const plain = execFileSync('pandoc', ['-t', 'plain', '--wrap=none', '--lua-filter', filter, path], { encoding: 'utf8' });
    return plain
      .split(/\n\s*\n/)
      .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const LIST_LABEL = /^(\d+|[a-zA-Z]|[ivxlcdm]+)[.)] /;

describe.skipIf(!samplesAvailable || !hasPandoc())('docxText', () => {
  it.each([
    ['Original', ORIGINAL_SAMPLE, 'original'],
    ['Edited', EDITED_SAMPLE, 'edited'],
  ] as const)('matches pandoc on the %s sample, apart from automatic list labels', (_name, path, side) => {
    const ours = docxText(readSamples()[side]);
    const pandoc = pandocParagraphs(path);
    expect(ours).toHaveLength(pandoc.length);
    let labelled = 0;
    ours.forEach((line, i) => {
      const theirs = pandoc[i]!;
      if (line === theirs) return;
      expect(theirs.replace(LIST_LABEL, ''), `paragraph ${i}`).toBe(line);
      labelled++;
    });
    // The list items with automatic numbering: 14 in the Original, 15 in the Edited.
    expect(labelled).toBeLessThanOrEqual(15);
  });
});
