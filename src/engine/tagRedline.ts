// The HTML converter emits no revision ids, only `data-author`. Before rendering, each revision's
// markup gets the author `rev:<revisionId>`, so the HTML says which revision an element belongs
// to (PRD §7.4). The tagged copy is only rendered; export works on the untagged redline.
import { ElementIndex, W_NS, parseConstituentKey, readPart, unzipDocx, writePart, zipDocx } from './ooxml';
import type { RevisionListEntry } from './types';

const AUTHOR_PREFIX = 'rev:';

/** The `data-author` value the tagged HTML carries for a revision. */
export function revisionAuthor(revisionId: string): string {
  return AUTHOR_PREFIX + revisionId;
}

/** The revision id in a tagged `data-author` value, or `null` for any other author. */
export function revisionIdFromAuthor(author: string | null | undefined): string | null {
  return author?.startsWith(AUTHOR_PREFIX) ? author.slice(AUTHOR_PREFIX.length) : null;
}

export interface TaggedRedline {
  bytes: Uint8Array;
  /**
   * Constituent keys whose element was not found, or not found uniquely (expected empty; reported,
   * not fatal, since tagging only affects display).
   */
  missingKeys: string[];
}

/**
 * Returns a copy of the redline in which every markup element of every revision that carries a
 * `w:author` has it set to `rev:<revisionId>`. Elements without an author (e.g. range end markers)
 * are left alone.
 */
export function tagRedline(redline: Uint8Array, revisions: readonly RevisionListEntry[]): TaggedRedline {
  const files = unzipDocx(redline);
  const missingKeys: string[] = [];

  const byPart = new Map<string, RevisionListEntry[]>();
  for (const revision of revisions) {
    const list = byPart.get(revision.partUri) ?? [];
    list.push(revision);
    byPart.set(revision.partUri, list);
  }

  for (const [partUri, partRevisions] of byPart) {
    const document = readPart(files, partUri);
    if (!document) {
      missingKeys.push(...partRevisions.flatMap((r) => r.constituentKeys));
      continue;
    }
    const index = new ElementIndex(document);
    for (const revision of partRevisions) {
      for (const key of revision.constituentKeys) {
        const element = index.find(parseConstituentKey(key));
        if (!element) {
          missingKeys.push(key);
          continue;
        }
        if (element.hasAttributeNS(W_NS, 'author')) {
          element.setAttributeNS(W_NS, 'w:author', revisionAuthor(revision.id));
        }
      }
    }
    writePart(files, partUri, document);
  }

  return { bytes: zipDocx(files), missingKeys };
}
