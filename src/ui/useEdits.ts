// The live review state with inline edits (docs/architecture.md, "Inline edits"). A comparison
// stays as it was compared; the edits live here, one `BlockEdit` per edited block, and so do the
// values derived from the comparison and the edits: the items, their texts, the document index
// and the headings. An update touches one block: its segments, its items (existing ids kept), and
// its markup in the master document (`comparison.document.body`), from which the panels copy it.
import { useCallback, useMemo, useState } from 'react';
import type { BlockEditPatch, DocumentHeading, RevisionListEntry } from '../engine/types';
import { replaceBlockItems, type ChangeItem } from '../model/changes';
import { replaceIndexBlock, type DocIndex } from '../model/docIndex';
import { collectItemTexts, relabelTextUnchanged, type ItemText } from '../model/equivalence';
import { editedHeadingBlocks, editedParagraphText, withEditedHeadings } from '../model/outline';
import {
  applyTextEdit,
  blockItems,
  editRevisions,
  revisionTexts,
  visibleText,
  type BlockEdit,
  type RevisionText,
  type Segment,
} from '../model/paragraphEdit';
import { readBlockSegments, renderBlockSegments } from './blockSegments';
import type { PanelControl } from './DocumentPanel';
import { decorateDocument, isolateCommonAffixes, markItems } from './renderedDocument';
import type { Comparison } from './useComparison';

type Headings = { original: DocumentHeading[]; edited: DocumentHeading[] };

/** What an update changed: the block's new markup in the master document, and its items. */
export interface BlockUpdate {
  unid: string;
  /** The block's element in the master document (the panels import a copy). */
  block: HTMLElement;
  /** Items no longer in the block, and items new in it. */
  removedItemIds: string[];
  addedItemIds: string[];
  /** Items whose id a live edit just allocated: they start as accepted. */
  createdItemIds: string[];
}

/** A saved edit to restore (`original` must be the block as compared now). */
export type SavedBlockEdit = BlockEdit;

const sameSegments = (a: readonly Segment[], b: readonly Segment[]) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The edits of one comparison and the values derived from them. Methods change the master
 * document and the session's state; each call that changes something bumps `version`.
 */
export class EditSession {
  readonly comparison: Comparison;
  blocks = new Map<string, BlockEdit>();
  items: ChangeItem[];
  itemTexts: Map<string, ItemText>;
  index: DocIndex;
  headings: Headings;
  version = 0;
  /** The engine's text of each insertion and deletion. */
  private readonly engineTexts: Map<string, RevisionText>;
  /** The edited blocks' current elements in the master document. */
  private readonly elements = new Map<string, HTMLElement>();
  /** Each edited block's element as the comparison prepared it, for a revert. */
  private readonly pristine = new Map<string, HTMLElement>();
  /** Each Edited heading's block as compared (`editedHeadingBlocks`); `null` until a heading is edited. */
  private headingBlocks: (string | undefined)[] | null = null;

  constructor(comparison: Comparison) {
    this.comparison = comparison;
    this.items = comparison.analysis.items;
    this.itemTexts = comparison.itemTexts;
    this.index = comparison.analysis.index;
    this.headings = comparison.result.headings;
    this.engineTexts = new Map(
      comparison.result.revisions.flatMap((revision) =>
        revision.type === 'insert' || revision.type === 'delete' ? [[revision.id, { type: revision.type, text: revision.text }] as const] : [],
      ),
    );
  }

  private get root(): HTMLElement {
    return this.comparison.document.body;
  }

  /** The master document's blocks by `data-anchor`, kept up to date with the edits. */
  private blockMap: Map<string, HTMLElement> | null = null;

  private get blockElements(): Map<string, HTMLElement> {
    this.blockMap ??= new Map([...this.root.querySelectorAll<HTMLElement>('[data-anchor]')].map((element) => [element.dataset.anchor!, element]));
    return this.blockMap;
  }

  private element(unid: string): HTMLElement {
    const element = this.blockElements.get(unid);
    if (!element) throw new Error(`No block ${unid}`);
    return element;
  }

  /** The block's element in the master document, kept up to date with the edits. */
  blockElement(unid: string): HTMLElement | undefined {
    return this.blockElements.get(unid);
  }

  /** The block's visible text (as the Edited panel shows it) after the last update. */
  visibleText(unid: string): string {
    return visibleText(this.edit(unid).current);
  }

  /** The block's edit, or a new one from its markup. */
  private edit(unid: string): BlockEdit {
    const existing = this.blocks.get(unid);
    if (existing) return existing;
    const segments = readBlockSegments(this.element(unid));
    return { unid, scope: this.index.blockByUnid.get(unid)?.scope ?? 'body', original: segments, current: segments, nextId: 1 };
  }

  /** Whether the block differs from the comparison's. */
  isEdited(unid: string): boolean {
    const edit = this.blocks.get(unid);
    return !!edit && !sameSegments(edit.original, edit.current);
  }

  /** The blocks that differ from the comparison's. */
  editedBlocks(): BlockEdit[] {
    return [...this.blocks.values()].filter((edit) => !sameSegments(edit.original, edit.current));
  }

  /**
   * Applies an edit of the block's visible text (`caret`: the cursor's offset in the new text).
   * `null` when it changes nothing.
   */
  update(unid: string, newVisible: string, caret?: number): BlockUpdate | null {
    const edit = this.edit(unid);
    const result = applyTextEdit(edit.current, newVisible, { unid, nextId: edit.nextId, caret });
    if (sameSegments(result.segments, edit.current)) return null;
    return this.apply({ ...edit, current: result.segments, nextId: result.nextId }, result.createdItemIds);
  }

  /** The block as the comparison produced it; `null` when it has no edits. */
  revert(unid: string): BlockUpdate | null {
    const edit = this.blocks.get(unid);
    if (!edit || !this.isEdited(unid)) return null;
    return this.apply({ ...edit, current: edit.original }, []);
  }

  revertAll(): BlockUpdate[] {
    return this.editedBlocks().flatMap((edit) => this.revert(edit.unid) ?? []);
  }

  /** Sets blocks to saved segments (a replay, an undo or redo): no item counts as created. */
  restore(saved: readonly SavedBlockEdit[]): { updates: BlockUpdate[]; skipped: number } {
    const updates: BlockUpdate[] = [];
    let skipped = 0;
    for (const record of saved) {
      let edit: BlockEdit;
      try {
        edit = this.edit(record.unid);
      } catch {
        skipped++;
        continue;
      }
      if (!sameSegments(edit.original, record.original)) {
        skipped++;
        continue;
      }
      const next = { ...edit, current: record.current, nextId: Math.max(edit.nextId, record.nextId) };
      if (sameSegments(next.current, edit.current)) {
        this.blocks.set(record.unid, next);
        continue;
      }
      try {
        updates.push(this.apply(next, []));
      } catch {
        skipped++;
      }
    }
    return { updates, skipped };
  }

  /** The engine's revisions and those the edits created, for the export. */
  revisions(): RevisionListEntry[] {
    const edited = this.editedBlocks();
    return edited.length === 0 ? this.comparison.result.revisions : [...this.comparison.result.revisions, ...edited.flatMap(editRevisions)];
  }

  /** The edited blocks' final segments, for the export. */
  patches(): BlockEditPatch[] {
    return this.editedBlocks().map(({ unid, scope, current }) => ({ unid, scope, segments: current }));
  }

  private apply(edit: BlockEdit, createdItemIds: string[]): BlockUpdate {
    const { unid } = edit;
    const before = this.blocks.get(unid) ?? this.edit(unid);
    const oldElement = this.element(unid);
    if (!this.pristine.has(unid)) this.pristine.set(unid, oldElement.cloneNode(true) as HTMLElement);
    // Matching the headings reads the whole document: done once, at the first edit of a block with
    // a heading's text (until then, the heading blocks are as compared).
    if (!this.headingBlocks && !this.blocks.has(unid)) {
      const text = editedParagraphText(oldElement);
      if (this.comparison.result.headings.edited.some((heading) => heading.text === text)) {
        this.headingBlocks = editedHeadingBlocks(this.root, this.comparison.result.headings);
      }
    }
    // Back to the comparison's segments: its markup and items as they were.
    const reverted = sameSegments(edit.current, edit.original);

    const beforeIds = new Set([...revisionTexts(before.current).values()].map(({ itemId }) => itemId));
    const parts = blockItems(edit, { items: new Map(this.items.map((item) => [item.id, item])), revisions: this.engineTexts });
    let items = replaceBlockItems(this.items, unid, beforeIds, parts, this.index);
    const afterIds = new Set(parts.map((part) => part.id));
    const itemTexts = new Map(this.itemTexts);
    for (const id of beforeIds) if (!afterIds.has(id)) itemTexts.delete(id);

    let element: HTMLElement;
    if (reverted) {
      element = this.pristine.get(unid)!.cloneNode(true) as HTMLElement;
      oldElement.replaceWith(element);
      this.blockElements.set(unid, element);
      const compared = new Map(this.comparison.analysis.items.map((item) => [item.id, item]));
      items = items.map((item, order) => {
        const original = afterIds.has(item.id) ? compared.get(item.id) : undefined;
        if (!original) return item;
        return original.order === order ? original : { ...original, order };
      });
      for (const id of afterIds) {
        const text = this.comparison.itemTexts.get(id);
        if (text) itemTexts.set(id, text);
      }
    } else {
      element = renderBlockSegments(oldElement, edit.current) as HTMLElement;
      const byId = new Map(items.map((item) => [item.id, item]));
      const blockItemList = parts.map((part) => byId.get(part.id)!);
      decorateDocument(element, blockItemList.filter((item) => item.kind !== 'formatting'), this.index);
      oldElement.replaceWith(element);
      this.blockElements.set(unid, element);

      // Texts and relabelling (identical text → formatting) for the items the edit changed or made.
      const changed = blockItemList.filter((item) => !this.items.includes(item));
      for (const [id, text] of collectItemTexts(this.blockElements, changed)) itemTexts.set(id, text);
      const relabelled = relabelTextUnchanged(changed, itemTexts).items;
      if (relabelled.some((item, i) => item !== changed[i])) {
        const replacements = new Map(relabelled.map((item) => [item.id, item]));
        items = items.map((item) => replacements.get(item.id) ?? item);
      }

      // The shared edges of replacements, and the formatting look, for the block's items as they are now.
      for (const piece of element.querySelectorAll<HTMLElement>('[data-common-needs]')) {
        delete piece.dataset.commonNeeds;
        piece.classList.remove('change-common');
      }
      const current = new Map(items.map((item) => [item.id, item]));
      isolateCommonAffixes(element, parts.map((part) => current.get(part.id)!));
      const formattingIds = new Set(
        [element, ...element.querySelectorAll<HTMLElement>('[data-change-id]')]
          .map((node) => node.dataset.changeId)
          .filter((id): id is string => id !== undefined && current.get(id)?.kind === 'formatting'),
      );
      markItems(element, formattingIds, 'change-as-formatting');
    }
    this.elements.set(unid, element);

    this.blocks.set(unid, edit);
    this.items = items;
    this.itemTexts = itemTexts;
    this.index = replaceIndexBlock(this.index, oldElement, element);
    this.headings = this.headingBlocks ? withEditedHeadings(this.comparison.result.headings, this.headingBlocks, this.elements) : this.headings;
    this.version++;
    return {
      unid,
      block: element,
      removedItemIds: [...beforeIds].filter((id) => !afterIds.has(id)),
      addedItemIds: [...afterIds].filter((id) => !beforeIds.has(id)),
      createdItemIds,
    };
  }
}

/**
 * Shows updates in the panels shown (each copies the master block), and has the items that live
 * edits created accepted (`accept`: e.g. a decisions dispatch).
 */
export function showBlockUpdates(updates: readonly BlockUpdate[], panels: readonly (PanelControl | null)[], accept: (itemIds: string[]) => void): void {
  for (const update of updates) for (const panel of panels) panel?.replaceBlock(update.unid, update.block);
  const created = updates.flatMap((update) => update.createdItemIds);
  if (created.length > 0) accept(created);
}

export interface Edits {
  session: EditSession | null;
  /** The live items, item texts, index and headings (the comparison's while nothing is edited). */
  items: ChangeItem[] | undefined;
  itemTexts: Map<string, ItemText> | undefined;
  index: DocIndex | undefined;
  headings: Headings | undefined;
  /** Bumps on every change; memos that read the session key on it. */
  version: number;
  update: (unid: string, newVisible: string, caret?: number) => BlockUpdate | null;
  revert: (unid: string) => BlockUpdate | null;
  revertAll: () => BlockUpdate[];
  restore: (saved: readonly SavedBlockEdit[]) => { updates: BlockUpdate[]; skipped: number };
}

/** The edits of the comparison: a new session (no edits) for each new comparison. */
export function useEdits(comparison: Comparison | null): Edits {
  const session = useMemo(() => (comparison ? new EditSession(comparison) : null), [comparison]);
  const [, setVersion] = useState(0);
  const changed = useCallback(<T,>(result: T) => {
    setVersion((version) => version + 1);
    return result;
  }, []);
  const update = useCallback((unid: string, text: string, caret?: number) => changed(session?.update(unid, text, caret) ?? null), [session, changed]);
  const revert = useCallback((unid: string) => changed(session?.revert(unid) ?? null), [session, changed]);
  const revertAll = useCallback(() => changed(session?.revertAll() ?? []), [session, changed]);
  const restore = useCallback((saved: readonly SavedBlockEdit[]) => changed(session?.restore(saved) ?? { updates: [], skipped: 0 }), [session, changed]);
  return {
    session,
    items: session?.items,
    itemTexts: session?.itemTexts,
    index: session?.index,
    headings: session?.headings,
    version: session?.version ?? 0,
    update,
    revert,
    revertAll,
    restore,
  };
}
