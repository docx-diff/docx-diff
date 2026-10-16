// Builds the reviewable change items from the engine's revision list (PRD §7.2 step 3, FR-8, FR-9).
import type { RevisionListEntry } from '../engine/types';
import { adjacencyKey, noteKey, type DocIndex, type IndexBlock } from './docIndex';

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

/**
 * A content deletion and insertion that replace one another: with the index, their text touches
 * (no unchanged text between them); without it, they share an anchor (the same paragraph). A
 * deletion of the unedited tail is never part of a replacement, even when an insertion touches
 * its start: it must stay a deletion for the range detection (FR-14).
 */
function isReplacePair(a: RevisionListEntry, b: RevisionListEntry, index: DocIndex | undefined): boolean {
  const families = new Set([a.family, b.family]);
  if (families.size !== 2 || !families.has('content_delete') || !families.has('content_insert')) return false;
  if (!index) return shareAnchor(a, b);
  return index.adjacentRevisions.has(adjacencyKey(a.id, b.id)) && !removesLastParagraph(a, index) && !removesLastParagraph(b, index);
}

/**
 * The last Original body paragraph, when the Edited document has nothing of it (it is wholly
 * deleted): the sign of an unedited tail (FR-14). `undefined` otherwise.
 */
export function deletedLastParagraph(index: DocIndex): string | undefined {
  const last = index.bodyParagraphs.at(-1);
  return last !== undefined && index.blockByUnid.get(last)?.inEdited === false ? last : undefined;
}

function removesLastParagraph(revision: RevisionListEntry, index: DocIndex): boolean {
  const last = deletedLastParagraph(index);
  return revision.type === 'delete' && last !== undefined && revision.affectedAnchors.some((anchor) => anchor.unid === last);
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
 *   (either order) and whose text touches (without the index: that share an anchor) become one
 *   `replaced` item, paired greedily left to right;
 * - a move revision (covering both halves) is a `moved` item;
 * - with the index, a note that only one version has joins the item of the revision that deletes
 *   (inserts) its reference (`foldWholeNotes`).
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
    if (next && isReplacePair(revision, next, index)) {
      group.push(next);
      groupOf.set(next, group);
      i++;
    }
    groupOf.set(revision, group);
    groups.push(group);
  }
  for (const { mark, into } of folded) {
    const group = groupOf.get(into)!;
    group.push(mark);
    groupOf.set(mark, group);
  }
  if (index) foldWholeNotes(sequence, groupOf, groups, index);
  for (const revision of revisions) {
    if (revision.type === 'format') groups.push([revision]);
  }

  const byPosition = (a: RevisionListEntry, b: RevisionListEntry) => listPosition.get(a.id)! - listPosition.get(b.id)!;
  for (const group of groups) group.sort(byPosition);
  groups.sort((a, b) => byPosition(a[0]!, b[0]!));

  return groups.map((group, order) => toItem(group, order, index));
}

/**
 * A footnote or endnote that only one version has — wholly deleted (inserted) — and whose
 * references are all deleted (inserted) content: the note's revisions join the group of the
 * revision that deletes (inserts) its first reference, so that the note and its reference are
 * decided together. Decided apart, a kept reference could point to a note without text, and a
 * restored note to no reference. A note both versions have (its text edited, or its reference
 * moved) keeps its own items.
 */
function foldWholeNotes(
  sequence: readonly RevisionListEntry[],
  groupOf: Map<RevisionListEntry, RevisionListEntry[]>,
  groups: RevisionListEntry[][],
  index: DocIndex,
): void {
  const byId = new Map(sequence.map((revision) => [revision.id, revision]));
  const notes = new Map<string, IndexBlock[]>();
  for (const block of index.blocks) {
    if (block.scope === 'body' || block.noteId === undefined) continue;
    const key = noteKey(block.scope, block.noteId);
    notes.set(key, [...(notes.get(key) ?? []), block]);
  }
  for (const [key, blocks] of notes) {
    const deleted = blocks.every((block) => !block.inEdited);
    const inserted = blocks.every((block) => !block.inOriginal);
    if (deleted === inserted) continue;
    const change = deleted ? 'del' : 'ins';
    const references = index.noteReferences.get(key) ?? [];
    if (references.length === 0 || !references.every((reference) => reference.change === change)) continue;
    const target = byId.get(references[0]!.revisionId ?? '');
    if (!target) continue;
    const targetGroup = groupOf.get(target)!;
    const unids = new Set(blocks.map((block) => block.unid));
    for (const revision of sequence) {
      if (revision.affectedAnchors.length === 0 || !revision.affectedAnchors.every((anchor) => unids.has(anchor.unid))) continue;
      const group = groupOf.get(revision)!;
      if (group === targetGroup) continue;
      targetGroup.push(...group);
      for (const member of group) groupOf.set(member, targetGroup);
      groups.splice(groups.indexOf(group), 1);
    }
  }
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
