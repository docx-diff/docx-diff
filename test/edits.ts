// Scripted inline edits for the export round trips (test/fixture-pairs.test.ts,
// test/sample-pair.test.ts): blocks of the decorated HTML read as segments
// (`src/ui/blockSegments.ts`), edited with the edit model (`applyTextEdit`), and handed to the export
// as patches with their new revisions; and what the redline paragraphs hold, to check the segments.
import type { Element as XmlElement } from '@xmldom/xmldom';
import { paragraphUnids } from '../src/engine/blockKey';
import { W_NS, readPart, unzipDocx } from '../src/engine/ooxml';
import type { BlockEditPatch, FinalDecision, RevisionListEntry } from '../src/engine/types';
import type { BlockScope } from '../src/model/docIndex';
import { OBJECT_CHAR, PART_OF_SCOPE, applyTextEdit, editRevisions, visibleText, type BlockEdit, type Segment } from '../src/model/paragraphEdit';
import { readBlockSegments } from '../src/ui/blockSegments';

export function scopeOfBlock(block: Element): BlockScope {
  const scope = ((block as HTMLElement).dataset.sourceAnchorId ?? '').split(':')[1];
  return scope === 'fn' || scope === 'en' ? scope : 'body';
}

/** One edit: the block's visible text before → after (e.g. a word typed), `caret` where it was made. */
export interface ScriptedEdit {
  unid: string;
  /** What the edit is, for messages. */
  label: string;
  change: (visible: string) => string;
  caret?: (visible: string) => number;
}

export interface ScriptedResult {
  blocks: BlockEdit[];
  patches: BlockEditPatch[];
  /** The revisions the edits created. */
  revisions: RevisionListEntry[];
  createdItemIds: string[];
}

/** Applies the edits in order (several may edit one block) to the blocks under `root`. */
export function scriptEdits(root: ParentNode, edits: readonly ScriptedEdit[]): ScriptedResult {
  const blocks = new Map<string, BlockEdit>();
  const createdItemIds: string[] = [];
  for (const edit of edits) {
    let block = blocks.get(edit.unid);
    if (!block) {
      const element = root.querySelector(`[data-anchor="${edit.unid}"]`);
      if (!element) throw new Error(`test setup: no block ${edit.unid}`);
      const segments = readBlockSegments(element);
      block = { unid: edit.unid, scope: scopeOfBlock(element), original: segments, current: segments, nextId: 1 };
      blocks.set(edit.unid, block);
    }
    const after = edit.change(visibleText(block.current));
    const result = applyTextEdit(block.current, after, { unid: block.unid, nextId: block.nextId, caret: edit.caret?.(after) });
    block.current = result.segments;
    block.nextId = result.nextId;
    createdItemIds.push(...result.createdItemIds);
  }
  const list = [...blocks.values()];
  return {
    blocks: list,
    patches: list.map((block) => ({ unid: block.unid, scope: block.scope, segments: block.current })),
    revisions: list.flatMap(editRevisions),
    createdItemIds,
  };
}

/** The visible-text offset where segment `index` starts. */
export function visibleOffset(segments: readonly Segment[], index: number): number {
  return visibleText(segments.slice(0, index)).length;
}

/**
 * The block's text under the decisions, as `test/expectedText.ts` writes a paragraph's: unchanged
 * text, deleted text when rejected, inserted text when accepted; tabs and breaks as spaces, note
 * references as nothing.
 */
export function segmentsText(segments: readonly Segment[], decisions: ReadonlyMap<string, FinalDecision>): string {
  const kept = (change: 'del' | 'ins', revisionId: string) => {
    const decision = decisions.get(revisionId);
    if (decision === undefined || decision === 'track') throw new Error(`test setup: no decision for ${revisionId}`);
    return (change === 'ins') === (decision === 'accept');
  };
  return segments
    .map((segment) => {
      if (segment.kind === 'object') {
        if (segment.owner && !kept(segment.owner.change, segment.owner.revisionId)) return '';
        return segment.key === 'tab' || segment.key === 'br' ? ' ' : '';
      }
      if (segment.kind === 'equal') return segment.text;
      return kept(segment.kind, segment.revisionId) ? segment.text : '';
    })
    .join('');
}

/** Paragraph content the edit patch refuses (and that the HTML doesn't mark): fields, content controls, symbols, … */
const UNPATCHABLE = new Set([
  'fldChar', 'fldSimple', 'instrText', 'delInstrText', 'sdt', 'sym', 'noBreakHyphen', 'ptab', 'drawing', 'pict', 'object', 'moveFrom', 'moveTo',
]);

export interface RedlineParagraph {
  element: XmlElement;
  /** The paragraph's text without insertions, and without deletions; objects as `OBJECT_CHAR`. */
  original: string;
  edited: string;
  /** It holds content the patch refuses, or a nested paragraph. */
  unpatchable: boolean;
  /** Its ordinal among the part's `w:p` elements (for `expectedText`'s overrides). */
  ordinal: number;
}

/** Every redline paragraph by `<scope>:<unid>`. */
export async function redlineParagraphs(redline: Uint8Array): Promise<Map<string, RedlineParagraph>> {
  const files = unzipDocx(redline);
  const found = new Map<string, RedlineParagraph>();
  for (const [scope, partUri] of Object.entries(PART_OF_SCOPE)) {
    const part = readPart(files, partUri);
    if (!part) continue;
    const all = part.getElementsByTagNameNS(W_NS, 'p');
    const ordinals = new Map<XmlElement, number>();
    for (let i = 0; i < all.length; i++) ordinals.set(all.item(i)!, i);
    for (const [unid, element] of await paragraphUnids(part)) {
      let unpatchable = false;
      const text = (skip: string) => {
        let result = '';
        const walk = (node: XmlElement, skipped: boolean) => {
          for (let child = node.firstChild; child; child = child.nextSibling) {
            if (child.nodeType !== child.ELEMENT_NODE) continue;
            const el = child as XmlElement;
            if (el.namespaceURI !== W_NS) {
              unpatchable = true;
              continue;
            }
            const name = el.localName!;
            if (UNPATCHABLE.has(name) || name === 'p') unpatchable = true;
            const inSkip = skipped || name === skip;
            if (name === 't' || name === 'delText') {
              if (!inSkip) result += el.textContent ?? '';
            } else if (['tab', 'br', 'cr', 'footnoteReference', 'endnoteReference'].includes(name)) {
              if (!inSkip) result += OBJECT_CHAR;
            } else if (name !== 'pPr' && name !== 'p') {
              walk(el, inSkip);
            }
          }
        };
        walk(element, false);
        return result;
      };
      found.set(`${scope}:${unid}`, { element, original: text('ins'), edited: text('del'), unpatchable, ordinal: ordinals.get(element)! });
    }
  }
  return found;
}

/** NBSP and space are the same character to the edit model and the patch. */
export const spaces = (text: string) => text.replace(/ /g, ' ');

export type Scenario = 'insert a word' | 'delete a word' | 'edit inside an insertion' | 'edit between two changes' | 'type the Original back';
export const SCENARIOS: readonly Scenario[] = ['type the Original back', 'edit between two changes', 'edit inside an insertion', 'insert a word', 'delete a word'];

/** The scenario's edit of a block with these segments, or `undefined` when the block has no place for it. */
export function scenarioEdit(unid: string, segments: readonly Segment[], scenario: Scenario): ScriptedEdit | undefined {
  const at = (index: number, match: RegExpExecArray | null, group = 0) =>
    match ? visibleOffset(segments, index) + match.index + match[0].indexOf(match[group]!) : undefined;
  const splice = (start: number, length: number, text: string): ScriptedEdit => ({
    unid,
    label: scenario,
    change: (visible) => visible.slice(0, start) + text + visible.slice(start + length),
    caret: () => start + text.length,
  });
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!;
    switch (scenario) {
      case 'insert a word': {
        const start = segment.kind === 'equal' ? at(i, /\s\p{L}/u.exec(segment.text)) : undefined;
        if (start !== undefined) return splice(start + 1, 0, 'inserted ');
        break;
      }
      case 'delete a word': {
        const match = segment.kind === 'equal' ? /\s(\p{L}{2,} )/u.exec(segment.text) : null;
        if (match) return splice(at(i, match, 1)!, match[1]!.length, '');
        break;
      }
      case 'edit inside an insertion': {
        const match = segment.kind === 'ins' ? /\p{L}{3,}/u.exec(segment.text) : null;
        if (match) return splice(at(i, match)! + 1, 1, 'x');
        break;
      }
      case 'edit between two changes': {
        const next = segments[i + 1];
        const after = segments.slice(i + 2).some((s) => s.kind === 'del' || s.kind === 'ins');
        if ((segment.kind === 'del' || segment.kind === 'ins') && next?.kind === 'equal' && after) {
          const start = at(i + 1, /\s\p{L}/u.exec(next.text));
          if (start !== undefined) return splice(start + 1, 0, 'between ');
        }
        break;
      }
      case 'type the Original back': {
        const next = segments[i + 1];
        if (next && segment.kind !== 'equal' && segment.kind !== 'object' && next.kind !== 'equal' && next.kind !== 'object' && segment.kind !== next.kind && segment.itemId === next.itemId) {
          const [removed, added] = segment.kind === 'del' ? [segment, next] : [next, segment];
          const start = visibleOffset(segments, segment.kind === 'ins' ? i : i + 1);
          return splice(start, added.text.length, removed.text);
        }
        break;
      }
    }
  }
  return undefined;
}

/** One edit per scenario, each on the first block (of `blocks`, in order) that has a place for it and no edit yet. */
export function pickScenarios(blocks: readonly Element[], scenarios: readonly Scenario[] = SCENARIOS): ScriptedEdit[] {
  const used = new Set<string>();
  const edits: ScriptedEdit[] = [];
  for (const scenario of scenarios) {
    for (const block of blocks) {
      const unid = (block as HTMLElement).dataset.anchor!;
      if (used.has(unid)) continue;
      const edit = scenarioEdit(unid, readBlockSegments(block), scenario);
      if (!edit) continue;
      used.add(unid);
      edits.push(edit);
      break;
    }
  }
  return edits;
}

/**
 * The paragraph blocks the tests may edit: inline edits leave out paragraphs with moves, with an
 * inserted or deleted mark, those another paragraph is joined into, and those the patch refuses.
 */
export function editableBlocks(root: ParentNode, paragraphs: ReadonlyMap<string, RedlineParagraph>): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(':is(p, h1, h2, h3, h4, h5, h6)[data-anchor]')].filter((block) => {
    const paragraph = paragraphs.get(`${scopeOfBlock(block)}:${block.dataset.anchor}`);
    const previous = block.previousElementSibling;
    return (
      !!paragraph &&
      !paragraph.unpatchable &&
      !block.matches('.rev-para-ins, .rev-para-del') &&
      !block.querySelector('.rev-move-from, .rev-move-to, .rev-para-mark-del') &&
      !previous?.matches('[data-anchor].rev-para-ins, [data-anchor].rev-para-del')
    );
  });
}

/** `expectedText` overrides for the edited blocks under the decisions. */
export function editedOverrides(
  result: ScriptedResult,
  paragraphs: ReadonlyMap<string, RedlineParagraph>,
  decisions: ReadonlyMap<string, FinalDecision>,
): Map<string, Map<number, string>> {
  const overrides = new Map<string, Map<number, string>>();
  for (const block of result.blocks) {
    const partUri = PART_OF_SCOPE[block.scope];
    const part = overrides.get(partUri) ?? new Map<number, string>();
    part.set(paragraphs.get(`${block.scope}:${block.unid}`)!.ordinal, segmentsText(block.current, decisions));
    overrides.set(partUri, part);
  }
  return overrides;
}
