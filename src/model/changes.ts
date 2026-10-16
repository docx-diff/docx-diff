// Builds the reviewable change items from the engine's revision list (PRD §7.2 step 3, FR-8, FR-9).
import type { RevisionListEntry } from '../engine/types';
import type { DocIndex } from './docIndex';

export type ChangeKind = 'inserted' | 'deleted' | 'replaced' | 'formatting' | 'moved' | 'paragraph';

export interface ChangeLocation {
  scope: 'body' | 'footnote' | 'endnote' | 'table';
  /** The note's id (`w:id`, as in the HTML's `fn-<id>` / `en-<id>`), for footnote and endnote items. */
  noteId?: string;
}

export interface ChangeItem {
  /** Stable: the first engine revision id the item contains (ids are deterministic per inputs and engine version). */
  id: string;
  kind: ChangeKind;
  /** Every engine revision this item decides, in list order (including folded paragraph marks). */
  revisionIds: string[];
  /** Text present only in the Original (`¶` = paragraph mark); '' when none. */
  removedText: string;
  /** Text present only in the Edited document; '' when none. */
  addedText: string;
  /** The text a formatting or moved item covers. */
  text?: string;
  /** Formatting items: what changed, from the HTML titles, e.g. "Bold removed, Font changed". */
  description?: string;
  location: ChangeLocation;
  wordDelta: { removed: number; added: number };
  /** Index in document order. */
  order: number;
  /** `affectedAnchors` unids of all its revisions, without duplicates. */
  anchors: string[];
}

/** A paragraph-mark revision that carries no text, only `¶` characters. */
export function isBareParagraphMark(revision: RevisionListEntry): boolean {
  return revision.family === 'paragraph_mark' && /^¶+$/.test(revision.text);
}

function shareAnchor(a: RevisionListEntry, b: RevisionListEntry): boolean {
  const unids = new Set(a.affectedAnchors.map((anchor) => anchor.unid));
  return b.affectedAnchors.some((anchor) => unids.has(anchor.unid));
}

function isReplacePair(a: RevisionListEntry, b: RevisionListEntry): boolean {
  const families = new Set([a.family, b.family]);
  return families.size === 2 && families.has('content_delete') && families.has('content_insert') && shareAnchor(a, b);
}

export function countWords(text: string): number {
  return text.split(/[\s¶]+/u).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

/**
 * Groups revisions into change items:
 * - every formatting revision (`type: "format"`) is its own `formatting` item;
 * - the other revisions form a sequence (formatting revisions are interleaved with them in the
 *   engine's list and are skipped here). In it, a bare paragraph mark joins the previous revision
 *   if they share an affected anchor, else the next one on the same condition, else it is a
 *   `paragraph` item. A paragraph mark carrying text is an ordinary deletion/insertion;
 * - of the remaining sequence, a content deletion and a content insertion that are neighbours
 *   (either order) and share an anchor become one `replaced` item, paired greedily left to right;
 * - a move revision (covering both halves) is a `moved` item.
 *
 * The optional index (from the rendered HTML) supplies formatting descriptions and note/table locations.
 */
export function buildChangeItems(revisions: readonly RevisionListEntry[], index?: DocIndex): ChangeItem[] {
  const listPosition = new Map(revisions.map((revision, position) => [revision.id, position]));
  const groups: RevisionListEntry[][] = [];

  const sequence = revisions.filter((revision) => revision.type !== 'format');
  const groupOf = new Map<RevisionListEntry, RevisionListEntry[]>();
  const folded: { mark: RevisionListEntry; into: RevisionListEntry }[] = [];
  const unfolded: RevisionListEntry[] = [];
  sequence.forEach((revision, i) => {
    if (isBareParagraphMark(revision)) {
      const previous = sequence[i - 1];
      const next = sequence[i + 1];
      const into = [previous, next].find(
        (neighbour) => neighbour && !isBareParagraphMark(neighbour) && shareAnchor(neighbour, revision),
      );
      if (into) {
        folded.push({ mark: revision, into });
        return;
      }
    }
    unfolded.push(revision);
  });

  for (let i = 0; i < unfolded.length; i++) {
    const revision = unfolded[i]!;
    const next = unfolded[i + 1];
    const group = [revision];
    if (next && isReplacePair(revision, next)) {
      group.push(next);
      groupOf.set(next, group);
      i++;
    }
    groupOf.set(revision, group);
    groups.push(group);
  }
  for (const { mark, into } of folded) groupOf.get(into)!.push(mark);
  for (const revision of revisions) {
    if (revision.type === 'format') groups.push([revision]);
  }

  const byPosition = (a: RevisionListEntry, b: RevisionListEntry) => listPosition.get(a.id)! - listPosition.get(b.id)!;
  for (const group of groups) group.sort(byPosition);
  groups.sort((a, b) => byPosition(a[0]!, b[0]!));

  return groups.map((group, order) => toItem(group, order, index));
}

function toItem(group: RevisionListEntry[], order: number, index: DocIndex | undefined): ChangeItem {
  const first = group[0]!;
  const removedText = group.filter((r) => r.type === 'delete').map((r) => r.text).join('');
  const addedText = group.filter((r) => r.type === 'insert').map((r) => r.text).join('');
  const anchors = [...new Set(group.flatMap((r) => r.affectedAnchors.map((anchor) => anchor.unid)))];
  const item: ChangeItem = {
    id: first.id,
    kind: kindOf(group),
    revisionIds: group.map((r) => r.id),
    removedText,
    addedText,
    location: locate(first, anchors, index),
    wordDelta: { removed: countWords(removedText), added: countWords(addedText) },
    order,
    anchors,
  };
  if (item.kind === 'formatting' || item.kind === 'moved') {
    item.text = group.find((r) => r.type === 'format' || r.type === 'move')!.text;
  }
  if (item.kind === 'formatting' && index) {
    const phrases = new Set(group.flatMap((r) => index.revisionTitles.get(r.id) ?? []));
    if (phrases.size > 0) item.description = [...phrases].join(', ');
  }
  return item;
}

function kindOf(group: RevisionListEntry[]): ChangeKind {
  if (group.some((r) => r.type === 'format')) return 'formatting';
  if (group.some((r) => r.type === 'move')) return 'moved';
  const families = new Set(group.map((r) => r.family));
  if (families.has('content_delete') && families.has('content_insert')) return 'replaced';
  if (group.every(isBareParagraphMark)) return 'paragraph';
  const primary = group.find((r) => !isBareParagraphMark(r)) ?? group[0]!;
  return primary.type === 'insert' ? 'inserted' : 'deleted';
}

function locate(first: RevisionListEntry, anchors: string[], index: DocIndex | undefined): ChangeLocation {
  const block = anchors.map((unid) => index?.blockByUnid.get(unid)).find((b) => b !== undefined);
  const scope = block?.scope ?? first.scope;
  if (scope === 'fn') return { scope: 'footnote', noteId: block?.noteId };
  if (scope === 'en') return { scope: 'endnote', noteId: block?.noteId };
  return { scope: block?.inTable ? 'table' : 'body' };
}
