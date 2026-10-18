// The export's first step with inline edits (docs/architecture.md, "Inline edits"): each edited
// block's redline paragraph is patched to its final segments, and the revision list is updated to
// the patched markup, so that every later step finds each revision's elements by its keys as usual.
//
// An edit never changes the Original text (`originalText` of the segments), so the paragraph's
// Original-side characters (unchanged and deleted) and the segments' line up one to one: each one
// keeps its place and may only turn from unchanged into deleted or back. Inserted text lies in the
// gaps between them; per gap, the paragraph's inserted characters are matched with the segments'
// (same revision), the others are removed or typed in. Everything else in the paragraph (bookmarks,
// comment ranges, hyperlinks, note references, …) stays where it is.
//
// To make that simple, the runs the patch changes or types next to are first split into one run per
// character or object, each inserted or deleted one in a `w:ins`/`w:del` of its own; after the patch,
// touching pieces of one revision and runs with the same properties are joined again. Split elements get new `w:id`s above
// every id of the text parts. Works on @xmldom/xmldom documents, since it runs in the worker.
import type { Document, Element, Node } from '@xmldom/xmldom';
import type { BlockScope } from '../model/docIndex';
import { PART_OF_SCOPE, type Segment } from '../model/paragraphEdit';
import { paragraphUnids } from './blockKey';
import { ElementIndex, W_NS, parseConstituentKey, readPart, writePart, type DocxFiles } from './ooxml';
import type { BlockEditPatch, RevisionListEntry } from './types';

/** An edit that cannot be applied to the redline (its paragraph is missing or doesn't match). */
export class EditPatchError extends Error {
  constructor(
    readonly unid: string,
    detail: string,
  ) {
    super(`The edited paragraph ${unid} cannot be exported: ${detail}.`);
    this.name = 'EditPatchError';
  }
}

const XML_NS = 'http://www.w3.org/XML/1998/namespace';
/** Run content shown as one placeholder (`OBJECT_CHAR`) in the segments. */
const OBJECTS = new Set(['tab', 'br', 'cr', 'footnoteReference', 'endnoteReference']);
/** Run content without text in either version. */
const ZERO_WIDTH = new Set(['lastRenderedPageBreak', 'softHyphen', 'footnoteRef', 'endnoteRef', 'annotationRef', 'commentReference']);
/** Paragraph content kept in place as it is. */
const MARKERS = new Set(['bookmarkStart', 'bookmarkEnd', 'commentRangeStart', 'commentRangeEnd', 'proofErr', 'permStart', 'permEnd']);
/** Paragraph content whose runs are walked: the runs stay inside them. */
const CONTAINERS = new Set(['hyperlink', 'smartTag']);
const CONTAINER_PROPERTIES = new Set(['smartTagPr']);
const WRAPPERS = new Set(['ins', 'del']);

/**
 * Patches the edited paragraphs in `files` (in place) and returns the revisions with their keys
 * updated: a revision the edits created gets the keys of its new markup (its entry is expected
 * in `revisions`, with any keys), and one whose markup the edits removed entirely is left out.
 */
export async function applyEdits(
  files: DocxFiles,
  revisions: readonly RevisionListEntry[],
  edits: readonly BlockEditPatch[],
): Promise<RevisionListEntry[]> {
  const known = new Set(revisions.map((revision) => revision.id));
  const keys = new Map<string, string[]>();
  const touched = new Set<string>();
  const parts = new Map<BlockScope, Document>();
  for (const scope of Object.keys(PART_OF_SCOPE) as BlockScope[]) {
    const document = readPart(files, PART_OF_SCOPE[scope]);
    if (document) parts.set(scope, document);
  }
  // The engine numbers revision markup across the parts; new ids follow every one of them.
  const ids = { next: Math.max(0, ...[...parts.values()].map(maxId)) + 1 };
  for (const scope of Object.keys(PART_OF_SCOPE) as BlockScope[]) {
    const partEdits = edits.filter((edit) => edit.scope === scope);
    if (partEdits.length === 0) continue;
    const partUri = PART_OF_SCOPE[scope];
    const document = parts.get(scope);
    if (!document) throw new EditPatchError(partEdits[0]!.unid, `the package has no part ${partUri}`);
    const result = await patchPart(document, revisions.filter((revision) => revision.partUri === partUri), partEdits, ids);
    for (const id of result.touched) {
      if (!known.has(id)) throw new EditPatchError(partEdits[0]!.unid, `revision ${id} has no entry`);
      touched.add(id);
    }
    for (const [id, partKeys] of result.keys) keys.set(id, [...(keys.get(id) ?? []), ...partKeys]);
    writePart(files, partUri, document);
  }
  return revisions.flatMap((revision) => {
    if (!touched.has(revision.id)) return [revision];
    const constituentKeys = keys.get(revision.id) ?? [];
    return constituentKeys.length > 0 ? [{ ...revision, constituentKeys }] : [];
  });
}

/** Which revision a markup element of an edited paragraph belongs to, and its key's `kind=`. */
interface Owner {
  revisionId: string;
  kind: string | undefined;
}

interface PartContext {
  document: Document;
  owners: Map<Element, Owner>;
  /** A `w:ins`/`w:del` of each revision, for the author and date of new ones. */
  wrapperOf: Map<string, Element>;
  /** The next free `w:id`. */
  ids: { next: number };
  /** Author and date for new `w:ins`/`w:del`, as the engine wrote them. */
  template: { author: string; date: string | null };
}

async function patchPart(
  document: Document,
  revisions: readonly RevisionListEntry[],
  edits: readonly BlockEditPatch[],
  ids: { next: number },
): Promise<{ keys: Map<string, string[]>; touched: Set<string> }> {
  const unids = await paragraphUnids(document);
  const paragraphs = new Set<Element>();
  for (const edit of edits) {
    const paragraph = unids.get(edit.unid);
    if (!paragraph) throw new EditPatchError(edit.unid, 'no paragraph of the redline has its anchor');
    paragraphs.add(paragraph);
  }

  // Each revision's keys outside the edited paragraphs stay; those inside are listed again after the patch.
  const index = new ElementIndex(document);
  const context: PartContext = { document, owners: new Map(), wrapperOf: new Map(), ids, template: { author: 'Docxodus', date: null } };
  const keys = new Map<string, string[]>();
  const touched = new Set<string>();
  let hasTemplate = false;
  for (const revision of revisions) {
    const outside: string[] = [];
    for (const keyText of revision.constituentKeys) {
      const key = parseConstituentKey(keyText);
      const element = index.find(key);
      if (element && WRAPPERS.has(key.localName) && !hasTemplate) {
        context.template = { author: element.getAttributeNS(W_NS, 'author') || context.template.author, date: element.getAttributeNS(W_NS, 'date') };
        hasTemplate = true;
      }
      if (element && paragraphs.has(paragraphOf(element)!)) {
        context.owners.set(element, { revisionId: revision.id, kind: key.kind });
        if (WRAPPERS.has(key.localName) && !context.wrapperOf.has(revision.id)) context.wrapperOf.set(revision.id, element);
        touched.add(revision.id);
      } else {
        outside.push(keyText);
      }
    }
    keys.set(revision.id, outside);
  }

  for (const edit of edits) {
    const paragraph = unids.get(edit.unid)!;
    patchParagraph(paragraph, edit, context);
    for (const segment of edit.segments) {
      if (segment.kind === 'del' || segment.kind === 'ins') touched.add(segment.revisionId);
    }
  }

  for (const paragraph of paragraphs) {
    for (const element of descendants(paragraph)) {
      const owner = context.owners.get(element);
      if (!owner) continue;
      const key = `${owner.kind ? `kind=${owner.kind}:` : ''}${W_NS}:${element.localName}:${element.getAttributeNS(W_NS, 'id')}`;
      const list = keys.get(owner.revisionId);
      if (list) list.push(key);
      else keys.set(owner.revisionId, [key]);
    }
  }
  return { keys, touched };
}

/** One character or object of the paragraph. */
interface Leaf {
  run: Element;
  /** The run, or its `w:ins`/`w:del`; a leaf the patch changes has them to itself. */
  slot: Element;
  object: boolean;
  /** The character (a whole code point); `''` for an object. */
  ch: string;
  side: 'equal' | 'del' | 'ins';
  revisionId?: string;
}

/** One character or object of the final segments. */
interface Unit {
  object: boolean;
  ch: string;
  side: 'equal' | 'del' | 'ins';
  revisionId?: string;
}

/** An Original-side character in both, or an inserted one only in the paragraph (removed), only in the segments (typed), or in both. */
type Step = { leaf: Leaf; unit: Unit } | { leaf: Leaf; unit?: undefined } | { leaf?: undefined; unit: Unit };

function patchParagraph(paragraph: Element, edit: BlockEditPatch, context: PartContext): void {
  const fail = (detail: string) => new EditPatchError(edit.unid, detail);
  const unpatchable = unpatchableContent(paragraph);
  if (unpatchable) throw fail(unpatchable);
  const units = unitsOf(edit.segments);
  // The runs the patch changes, or puts new text next to, are split first: then each of their
  // characters has a run (and `w:ins`/`w:del`) of its own.
  const affected = new Set<Element>();
  let previous: Leaf | undefined;
  let typed = false;
  for (const step of planSteps(collectLeaves(paragraph, context, fail), units, fail)) {
    if (!step.leaf) {
      if (previous) affected.add(previous.run);
      typed = true;
    } else if (!step.unit) {
      affected.add(step.leaf.run);
    } else {
      if (typed || step.leaf.side !== step.unit.side || step.leaf.revisionId !== step.unit.revisionId) affected.add(step.leaf.run);
      previous = step.leaf;
      typed = false;
    }
  }
  for (const run of affected) {
    const wrapper = run.parentNode as Element;
    splitRun(run, context);
    if (WRAPPERS.has(wrapper.localName!) && wrapper.namespaceURI === W_NS) splitWrapper(wrapper, context);
  }
  const leaves = collectLeaves(paragraph, context, fail);
  const steps = planSteps(leaves, units, fail);

  const visibleChar = (step: Step) => !!step.leaf && !!step.unit && !step.leaf.object && step.unit.side !== 'del';
  const fallbackRun = leaves.find((leaf) => !leaf.object)?.run;
  let cursor: Element | null = null;
  let lastRun: Element | undefined;
  steps.forEach((step, i) => {
    if (step.leaf && !step.unit) {
      unwrap(step.leaf.slot, (child) => child !== step.leaf!.run);
      return;
    }
    if (step.leaf && step.unit) {
      retype(step.leaf, step.unit, context, fail);
      cursor = step.leaf.slot;
      if (visibleChar(step)) lastRun = step.leaf.run;
      return;
    }
    const unit = step.unit!;
    if (unit.object) throw fail('an object was added');
    const source = lastRun ?? steps.slice(i + 1).find(visibleChar)?.leaf!.run ?? fallbackRun;
    const run = newRun(context, source, unit.ch, 't');
    const slot = wrap(run, 'ins', { revisionId: unit.revisionId!, kind: 'Content' }, context);
    if (cursor) {
      cursor.parentNode!.insertBefore(slot, cursor.nextSibling);
    } else {
      const next = steps.slice(i + 1).find((later) => later.leaf && later.unit)?.leaf!.slot;
      if (next) next.parentNode!.insertBefore(slot, next);
      else paragraph.appendChild(slot);
    }
    cursor = slot;
    lastRun = run;
  });

  joinPieces(paragraph, context);
}

/**
 * The patch in final order: per gap between Original-side characters (which the paragraph and the
 * segments share one to one), its inserted characters matched up, then the next Original-side one.
 */
function planSteps(leaves: Leaf[], units: Unit[], fail: (detail: string) => Error): Step[] {
  const isOriginal = (item: Leaf | Unit) => item.side !== 'ins';
  const originalLeaves = leaves.filter(isOriginal);
  const originalUnits = units.filter(isOriginal);
  if (originalLeaves.length !== originalUnits.length) throw fail('its Original text differs from the edit’s');
  originalLeaves.forEach((leaf, i) => {
    const unit = originalUnits[i]!;
    if (leaf.object !== unit.object || (!leaf.object && !sameChar(leaf.ch, unit.ch))) throw fail(`its Original text differs from the edit’s at ${i}`);
  });

  const gaps = <T extends Leaf | Unit>(items: T[]): T[][] => {
    const found: T[][] = [[]];
    for (const item of items) {
      if (isOriginal(item)) found.push([]);
      else found.at(-1)!.push(item);
    }
    return found;
  };
  const leafGaps = gaps(leaves);
  const unitGaps = gaps(units);
  const steps: Step[] = [];
  leafGaps.forEach((gap, k) => {
    steps.push(...matchInserted(gap, unitGaps[k]!));
    if (k < originalLeaves.length) steps.push({ leaf: originalLeaves[k]!, unit: originalUnits[k]! });
  });
  return steps;
}

const isSpace = (ch: string) => ch === ' ' || ch === '\u00a0';
/** The HTML shows some spaces as no-break spaces. */
const sameChar = (a: string, b: string) => a === b || (isSpace(a) && isSpace(b));

function unitsOf(segments: readonly Segment[]): Unit[] {
  const units: Unit[] = [];
  for (const segment of segments) {
    if (segment.kind === 'object') {
      units.push({ object: true, ch: '', side: segment.owner?.change ?? 'equal', revisionId: segment.owner?.revisionId });
    } else {
      const revisionId = segment.kind === 'equal' ? undefined : segment.revisionId;
      for (const ch of Array.from(segment.text)) units.push({ object: false, ch, side: segment.kind, revisionId });
    }
  }
  return units;
}

/** Matches a gap's inserted characters in the paragraph with the segments' (same character and revision), keeping their order. */
function matchInserted(leaves: Leaf[], units: Unit[]): Step[] {
  const same = (leaf: Leaf, unit: Unit) =>
    leaf.object === unit.object && sameChar(leaf.ch, unit.ch) && leaf.revisionId === unit.revisionId;
  let start = 0;
  while (start < leaves.length && start < units.length && same(leaves[start]!, units[start]!)) start++;
  let end = 0;
  while (end < leaves.length - start && end < units.length - start && same(leaves[leaves.length - 1 - end]!, units[units.length - 1 - end]!)) end++;
  const head: Step[] = leaves.slice(0, start).map((leaf, i) => ({ leaf, unit: units[i]! }));
  const tail: Step[] = leaves.slice(leaves.length - end).map((leaf, i) => ({ leaf, unit: units[units.length - end + i]! }));

  // Longest common subsequence of the rest.
  const a = leaves.slice(start, leaves.length - end);
  const b = units.slice(start, units.length - end);
  const lengths = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lengths[i]![j] = same(a[i]!, b[j]!) ? lengths[i + 1]![j + 1]! + 1 : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!);
    }
  }
  const middle: Step[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && same(a[i]!, b[j]!)) middle.push({ leaf: a[i++]!, unit: b[j++]! });
    else if (i < a.length && (j === b.length || lengths[i + 1]![j]! >= lengths[i]![j + 1]!)) middle.push({ leaf: a[i++]! });
    else middle.push({ unit: b[j++]! });
  }
  return [...head, ...middle, ...tail];
}

/** Turns an Original-side character unchanged ↔ deleted, as the segments have it. */
function retype(leaf: Leaf, unit: Unit, context: PartContext, fail: (detail: string) => Error): void {
  if (leaf.side === unit.side && leaf.revisionId === unit.revisionId) return;
  if (leaf.object) throw fail('an object’s change differs');
  if (leaf.side === 'equal' && unit.side === 'del') {
    renameText(leaf.run, 'delText');
    const placeholder = context.document.createTextNode('');
    leaf.run.parentNode!.replaceChild(placeholder, leaf.run);
    leaf.slot = wrap(leaf.run, 'del', { revisionId: unit.revisionId!, kind: 'Content' }, context);
    placeholder.parentNode!.replaceChild(leaf.slot, placeholder);
  } else if (leaf.side === 'del' && unit.side === 'equal') {
    renameText(leaf.run, 't');
    unwrap(leaf.slot, () => true);
    leaf.slot = leaf.run;
  } else {
    throw fail(`a character of revision ${leaf.revisionId ?? '(none)'} would belong to ${unit.revisionId ?? '(none)'}`);
  }
  leaf.side = unit.side;
  leaf.revisionId = unit.revisionId;
}

/**
 * Why the patch can't keep the paragraph's content in place (`undefined` when it can): anything but
 * runs of text, tabs, breaks, note references and zero-width marks, single `w:ins`/`w:del`,
 * hyperlinks and smart tags outside changes, and markers. Such paragraphs are not editable.
 */
export function unpatchableContent(paragraph: Element): string | undefined {
  const visit = (parent: Element, inWrapper: boolean): string | undefined => {
    for (const child of elementChildren(parent)) {
      if (child.namespaceURI !== W_NS) return `it contains {${child.namespaceURI}}${child.localName}`;
      const name = child.localName!;
      let found: string | undefined;
      if (name === 'r') {
        for (const content of elementChildren(child)) {
          const contentName = content.namespaceURI === W_NS ? content.localName! : '';
          if (!['rPr', 't', 'delText'].includes(contentName) && !OBJECTS.has(contentName) && !ZERO_WIDTH.has(contentName)) {
            return `a run contains {${content.namespaceURI}}${content.localName}`;
          }
        }
      } else if (WRAPPERS.has(name)) {
        found = inWrapper ? `it contains a nested w:${name}` : visit(child, true);
      } else if (CONTAINERS.has(name)) {
        found = inWrapper ? `it contains a w:${name} inside a change` : visit(child, false);
      } else if (!(name === 'pPr' && parent === paragraph) && !MARKERS.has(name) && !CONTAINER_PROPERTIES.has(name)) {
        found = `it contains w:${name}`;
      }
      if (found) return found;
    }
    return undefined;
  };
  return visit(paragraph, false);
}

/** Splits a run into runs of one character or object each (zero-width content gets one too). */
function splitRun(run: Element, context: PartContext): void {
  const children = elementChildren(run);
  const rPr = children[0] && isW(children[0], 'rPr') ? children[0] : undefined;
  const own = children.filter((child) => child !== rPr);
  if (own.length === 0 || (own.length === 1 && Array.from(own[0]!.textContent ?? '').length <= 1)) return;
  const contents: Element[] = [];
  for (const child of own) {
    if (isW(child, 't') || isW(child, 'delText')) {
      for (const ch of Array.from(child.textContent ?? '')) contents.push(textElement(context.document, child.localName!, ch));
    } else {
      contents.push(child);
    }
  }
  for (const content of contents) {
    const piece = run.cloneNode(false) as Element;
    if (rPr) piece.appendChild(cloneTracked(rPr, context));
    piece.appendChild(content);
    run.parentNode!.insertBefore(piece, run);
  }
  run.parentNode!.removeChild(run);
}

/** Gives each run of a `w:ins`/`w:del` a copy of it (with a new id); markers go with the run after them. */
function splitWrapper(wrapper: Element, context: PartContext): void {
  const children = elementChildren(wrapper);
  const runs = children.filter((child) => isW(child, 'r'));
  if (runs.length <= 1) return;
  let target = wrapper;
  let pending: Element[] = [];
  let first = true;
  for (const child of children) {
    pending.push(child);
    if (!isW(child, 'r')) continue;
    if (!first) {
      const copy = cloneTracked(wrapper, context, false);
      target.parentNode!.insertBefore(copy, target.nextSibling);
      target = copy;
      for (const moved of pending) copy.appendChild(moved);
    }
    first = false;
    pending = [];
  }
  for (const moved of pending) target.appendChild(moved);
}

function collectLeaves(paragraph: Element, context: PartContext, fail: (detail: string) => Error): Leaf[] {
  const leaves: Leaf[] = [];
  const visit = (parent: Element, wrapper: Element | null): void => {
    for (const child of elementChildren(parent)) {
      if (WRAPPERS.has(child.localName!) && child.namespaceURI === W_NS) visit(child, child);
      else if (CONTAINERS.has(child.localName!) && child.namespaceURI === W_NS) visit(child, null);
      else if (isW(child, 'r')) {
        const owner = wrapper ? context.owners.get(wrapper) : undefined;
        if (wrapper && !owner) throw fail(`its w:${wrapper.localName} ${wrapper.getAttributeNS(W_NS, 'id')} belongs to no revision`);
        const leaf = (object: boolean, ch: string): Leaf => ({
          run: child,
          slot: wrapper ?? child,
          object,
          ch,
          side: wrapper ? (wrapper.localName as 'ins' | 'del') : 'equal',
          revisionId: owner?.revisionId,
        });
        for (const content of elementChildren(child)) {
          if (isW(content, 't') || isW(content, 'delText')) leaves.push(...Array.from(content.textContent ?? '', (ch) => leaf(false, ch)));
          else if (OBJECTS.has(content.localName!)) leaves.push(leaf(true, ''));
        }
      }
    }
  };
  visit(paragraph, null);
  return leaves;
}

/** Joins touching `w:ins`/`w:del` of one revision, then touching text runs with the same properties. */
function joinPieces(paragraph: Element, context: PartContext): void {
  const parents = [paragraph, ...descendants(paragraph).filter((element) => element.namespaceURI === W_NS && (CONTAINERS.has(element.localName!) || WRAPPERS.has(element.localName!)))];
  for (const parent of parents) {
    joinSiblings(parent, (a, b) => {
      if (a.namespaceURI !== W_NS || b.namespaceURI !== W_NS || !WRAPPERS.has(a.localName!) || a.localName !== b.localName) return false;
      const [ownerA, ownerB] = [context.owners.get(a), context.owners.get(b)];
      if (!ownerA || ownerA.revisionId !== ownerB?.revisionId) return false;
      while (b.firstChild) a.appendChild(b.firstChild);
      return true;
    });
  }
  for (const parent of [paragraph, ...descendants(paragraph).filter((element) => element.namespaceURI === W_NS && (CONTAINERS.has(element.localName!) || WRAPPERS.has(element.localName!)))]) {
    joinSiblings(parent, (a, b) => {
      if (!isW(a, 'r') || !isW(b, 'r')) return false;
      const [textA, textB] = [runText(a), runText(b)];
      if (!textA || !textB || textA.localName !== textB.localName || runSignature(a, context) !== runSignature(b, context)) return false;
      textA.textContent = (textA.textContent ?? '') + (textB.textContent ?? '');
      textA.setAttributeNS(XML_NS, 'xml:space', 'preserve');
      return true;
    });
  }
}

/** Walks the element children; `join(a, b)` true means `b` was merged into `a`, which is then removed. */
function joinSiblings(parent: Element, join: (a: Element, b: Element) => boolean): void {
  let previous: Element | null = null;
  for (const child of elementChildren(parent)) {
    if (previous && join(previous, child)) parent.removeChild(child);
    else previous = child;
  }
}

/** The run's only content when it is a `w:t` or `w:delText`. */
function runText(run: Element): Element | undefined {
  const contents = elementChildren(run).filter((child) => !isW(child, 'rPr'));
  return contents.length === 1 && (isW(contents[0]!, 't') || isW(contents[0]!, 'delText')) ? contents[0] : undefined;
}

/** A run's properties, with the ids of revision markup replaced by its revision. */
function runSignature(run: Element, context: PartContext): string {
  const rPr = elementChildren(run).find((child) => isW(child, 'rPr'));
  if (!rPr) return '';
  const describe = (element: Element): string => {
    const owner = context.owners.get(element);
    const attributes: string[] = [];
    for (let i = 0; i < element.attributes.length; i++) {
      const attribute = element.attributes.item(i)!;
      if (owner && attribute.namespaceURI === W_NS && attribute.localName === 'id') continue;
      attributes.push(`${attribute.name}=${attribute.value}`);
    }
    const children = elementChildren(element).map(describe).join('');
    return `<${element.nodeName} ${attributes.sort().join(' ')}${owner ? ` @${owner.revisionId}` : ''}>${children}</>`;
  };
  return describe(rPr);
}

/** A run of `text` with the properties of `source` (without its revision markup, e.g. `w:rPrChange`). */
function newRun(context: PartContext, source: Element | undefined, text: string, textName: 't' | 'delText'): Element {
  const run = context.document.createElementNS(W_NS, 'w:r');
  const rPr = source && elementChildren(source).find((child) => isW(child, 'rPr'));
  if (rPr) {
    const copy = rPr.cloneNode(true) as Element;
    for (const element of [copy, ...descendants(copy)]) {
      if (element.hasAttributeNS(W_NS, 'id') && element !== copy) element.parentNode!.removeChild(element);
    }
    if (elementChildren(copy).length > 0) run.appendChild(copy);
  }
  run.appendChild(textElement(context.document, textName, text));
  return run;
}

/** Puts the element into a new `w:ins`/`w:del` of the revision. */
function wrap(element: Element, name: 'ins' | 'del', owner: Owner, context: PartContext): Element {
  const wrapper = context.document.createElementNS(W_NS, `w:${name}`);
  wrapper.setAttributeNS(W_NS, 'w:id', String(context.ids.next++));
  const like = context.wrapperOf.get(owner.revisionId);
  const author = like?.getAttributeNS(W_NS, 'author') || context.template.author;
  const date = like?.getAttributeNS(W_NS, 'date') || context.template.date;
  if (author) wrapper.setAttributeNS(W_NS, 'w:author', author);
  if (date) wrapper.setAttributeNS(W_NS, 'w:date', date);
  context.owners.set(wrapper, owner);
  if (!context.wrapperOf.has(owner.revisionId)) context.wrapperOf.set(owner.revisionId, wrapper);
  wrapper.appendChild(element);
  return wrapper;
}

/** A copy of the element in which each revision markup element has a new id and the same owner. */
function cloneTracked(element: Element, context: PartContext, deep = true): Element {
  const copy = element.cloneNode(deep) as Element;
  const originals = [element, ...(deep ? descendants(element) : [])];
  const copies = [copy, ...(deep ? descendants(copy) : [])];
  originals.forEach((original, i) => {
    const owner = context.owners.get(original);
    if (!owner) return;
    copies[i]!.setAttributeNS(W_NS, 'w:id', String(context.ids.next++));
    context.owners.set(copies[i]!, owner);
  });
  return copy;
}

/**
 * Removes a leaf's slot, keeping the children `keep` names in its place: unwraps a `w:ins`/`w:del`
 * (`keep` = every child) or removes a run (with the markers that went into its wrapper kept).
 */
function unwrap(slot: Element, keep: (child: Element) => boolean): void {
  const parent = slot.parentNode!;
  if (isW(slot, 'r')) {
    if (!keep(slot)) parent.removeChild(slot);
    return;
  }
  for (const child of elementChildren(slot)) if (keep(child)) parent.insertBefore(child, slot);
  parent.removeChild(slot);
}

function textElement(document: Document, name: string, text: string): Element {
  const element = document.createElementNS(W_NS, `w:${name}`);
  element.setAttributeNS(XML_NS, 'xml:space', 'preserve');
  element.appendChild(document.createTextNode(text));
  return element;
}

/** `w:t` ↔ `w:delText` of a one-character run. */
function renameText(run: Element, to: 't' | 'delText'): void {
  const text = elementChildren(run).find((child) => isW(child, 't') || isW(child, 'delText'));
  if (!text || text.localName === to) return;
  run.replaceChild(textElement(run.ownerDocument!, to, text.textContent ?? ''), text);
}

function maxId(document: Document): number {
  let max = 0;
  for (const element of document.documentElement ? [document.documentElement, ...descendants(document.documentElement)] : []) {
    const id = Number(element.getAttributeNS(W_NS, 'id'));
    if (Number.isFinite(id)) max = Math.max(max, id);
  }
  return max;
}

function paragraphOf(element: Element): Element | undefined {
  for (let node: Node | null = element; node; node = node.parentNode) {
    if (node.nodeType === node.ELEMENT_NODE && isW(node as Element, 'p')) return node as Element;
  }
  return undefined;
}

function isW(element: Element, localName: string): boolean {
  return element.namespaceURI === W_NS && element.localName === localName;
}

function elementChildren(parent: Element): Element[] {
  const children: Element[] = [];
  for (let child = parent.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === child.ELEMENT_NODE) children.push(child as Element);
  }
  return children;
}

/** The element's descendant elements in document order (an array: safe while changing the document). */
function descendants(parent: Element): Element[] {
  const found: Element[] = [];
  const walk = (element: Element) => {
    for (const child of elementChildren(element)) {
      found.push(child);
      walk(child);
    }
  };
  walk(parent);
  return found;
}
