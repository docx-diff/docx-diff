// One consistent look on export (FR-39a). All formatting follows the formatting choice; text that
// comes from the other version — a restored deletion when the Edited's formatting is used, an
// accepted insertion when the Original's is kept — would otherwise keep its own version's
// formatting (on the sample: Palatino words inside sans text). Such text takes the formatting it
// would have in the chosen version, judged from text both versions have:
// 1. the nearest run (paragraph) both versions have, if it looked the same in the other version:
//    its look in the chosen version;
// 2. else the most common chosen-version look of all runs (paragraphs) of the part that looked the
//    same in the other version (e.g. "Palatino, italic" → "italic");
// 3. else the nearest kept run's (paragraph's, paragraph mark's) formatting in the chosen version;
//    a paragraph keeps its own list numbering. Runs holding note references, fields or drawings
//    are left as they are.
// Changes outside the comparison range are left alone: the unedited tail keeps the Original's look
// (PRD open question 5, answered 2026-10-16).
//
// The plan is made on the redline before the reject rewrite (which discards the Edited properties
// of rejected formatting changes) and applied after it; the run and paragraph elements survive the
// rewrite.
import type { Document, Element } from '@xmldom/xmldom';
import { ElementIndex, W_NS, parseConstituentKey } from './ooxml';
import type { FormattingChoice, RevisionListEntry } from './types';

export type { FormattingChoice };

export interface LookOptions {
  formattingChoice: FormattingChoice;
  /** Revisions outside the comparison range (always rejected; left as they are). */
  outOfRange: ReadonlySet<string>;
}

type Side = 'O' | 'E';
type Status = 'both' | 'native' | 'foreign' | 'removed' | 'skip';

interface Props {
  elements: Element[];
  signature: string;
}

interface Unit {
  element: Element;
  status: Status;
  /** Its properties in the version that was not chosen (`both` and `foreign`). */
  other?: Props;
  /** Its properties in the export (`both` and `native`). */
  final?: Props;
}

interface RunUnit extends Unit {
  paragraph: Element | null;
  /** Holds text (`w:t`, `w:delText`, `w:tab`). */
  text: boolean;
  /** Holds a note reference, field or drawing: never given a neighbour's formatting. */
  special: boolean;
}

interface ParagraphUnit extends Unit {
  mark: { other?: Props; final?: Props };
}

const RUN_SKIP = ['rPrChange'];
const MARK_SKIP = ['ins', 'del', 'moveFrom', 'moveTo', 'rPrChange'];
const PARAGRAPH_SKIP = ['rPr', 'sectPr', 'pPrChange'];
const MARKUP_SIDE: Record<string, Side> = { ins: 'E', moveTo: 'E', del: 'O', moveFrom: 'O' };
const TEXT = ['t', 'delText', 'tab'];
const SPECIAL = ['footnoteReference', 'endnoteReference', 'fldChar', 'instrText', 'delInstrText', 'drawing', 'object', 'pict', 'fldSimple'];

function isW(element: Element | null | undefined, ...names: string[]): boolean {
  return !!element && element.nodeType === element.ELEMENT_NODE && element.namespaceURI === W_NS && names.includes(element.localName!);
}

function children(element: Element | undefined): Element[] {
  const result: Element[] = [];
  for (let child = element?.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === child.ELEMENT_NODE) result.push(child as Element);
  }
  return result;
}

function child(element: Element | undefined, name: string): Element | undefined {
  return children(element).find((candidate) => isW(candidate, name));
}

/**
 * The elements as an array. xmldom's lists are live: after any change to the document (cloning
 * property elements counts) the next access walks the whole document again.
 */
function elementsByName(document: Document, name: string): Element[] {
  const list = document.getElementsByTagNameNS(W_NS, name);
  const result: Element[] = [];
  for (let i = 0; i < list.length; i++) result.push(list.item(i)!);
  return result;
}

function descendants(element: Element, names: readonly string[]): boolean {
  return names.some((name) => element.getElementsByTagNameNS(W_NS, name).length > 0);
}

/** Name, attributes (without rsids) and children: equal for equal formatting. */
function signatureOf(element: Element): string {
  const attributes: string[] = [];
  for (let i = 0; i < element.attributes.length; i++) {
    const attribute = element.attributes.item(i)!;
    if (/^w:rsid/.test(attribute.name) || attribute.name.startsWith('xmlns')) continue;
    attributes.push(`${attribute.name}=${attribute.value}`);
  }
  return `${element.localName}[${attributes.sort().join(',')}](${children(element).map(signatureOf).join('')})`;
}

function props(container: Element | undefined, skip: readonly string[]): Props {
  const elements = children(container).filter((element) => !isW(element, ...skip));
  return { elements, signature: elements.map(signatureOf).join('') };
}

/** Deep copies, taken at planning time: the rewrite moves and replaces property elements. */
function copy(source: Props): Props {
  return { elements: source.elements.map((element) => element.cloneNode(true) as Element), signature: source.signature };
}

/** Replaces the container's properties, keeping the children named in `keepFirst` / `keepLast` in place. */
function replaceProps(container: Element, elements: readonly Element[], keepFirst: readonly string[], keepLast: readonly string[]): void {
  const current = children(container);
  const first = current.filter((element) => isW(element, ...keepFirst));
  const last = current.filter((element) => isW(element, ...keepLast));
  while (container.firstChild) container.removeChild(container.firstChild);
  for (const element of [...first, ...elements.map((e) => e.cloneNode(true) as Element), ...last]) container.appendChild(element);
}

function ensureChild(parent: Element, name: string): Element {
  const existing = child(parent, name);
  if (existing) return existing;
  const created = parent.ownerDocument!.createElementNS(W_NS, `w:${name}`);
  parent.insertBefore(created, parent.firstChild);
  return created;
}

/** Most common final look per other-version look, among the units both versions have. */
function learnMapping(units: readonly { status: Status; other?: Props; final?: Props }[]): Map<string, Props> {
  const counts = new Map<string, Map<string, { props: Props; count: number }>>();
  for (const unit of units) {
    if (unit.status !== 'both' || !unit.other || !unit.final) continue;
    const byFinal = counts.get(unit.other.signature) ?? new Map<string, { props: Props; count: number }>();
    const entry = byFinal.get(unit.final.signature) ?? { props: unit.final, count: 0 };
    entry.count++;
    byFinal.set(unit.final.signature, entry);
    counts.set(unit.other.signature, byFinal);
  }
  const mapping = new Map<string, Props>();
  for (const [other, byFinal] of counts) {
    const best = [...byFinal.values()].reduce((a, b) => (b.count > a.count ? b : a));
    mapping.set(other, best.props);
  }
  return mapping;
}

/**
 * For every position, the nearest unit before and after it that `accept` takes (one pass each
 * way, so long stretches of restored text stay linear). `around(at)` lists them, the one in the
 * same group (paragraph or container) first, then the one before.
 */
function nearestFinder<U>(units: readonly U[], accept: (unit: U) => boolean, group: (unit: U) => unknown): (at: number) => U[] {
  const before = new Int32Array(units.length).fill(-1);
  const after = new Int32Array(units.length).fill(-1);
  for (let i = 1, last = -1; i < units.length; i++) {
    if (accept(units[i - 1]!)) last = i - 1;
    before[i] = last;
  }
  for (let i = units.length - 2, last = -1; i >= 0; i--) {
    if (accept(units[i + 1]!)) last = i + 1;
    after[i] = last;
  }
  return (at) => {
    const found = [before[at]!, after[at]!].filter((i) => i >= 0).map((i) => units[i]!);
    const own = group(units[at]!);
    return found.sort((a, b) => Number(group(b) === own) - Number(group(a) === own));
  };
}

/**
 * Plans the consistent look for one part of the redline. Call before the reject rewrite; the
 * returned function applies the plan afterwards.
 */
export function planConsistentLook(
  document: Document,
  revisions: readonly RevisionListEntry[],
  decisions: ReadonlyMap<string, 'accept' | 'reject'>,
  options: LookOptions,
): () => void {
  const chosen: Side = options.formattingChoice === 'edited' ? 'E' : 'O';
  const index = new ElementIndex(document);
  const revisionOf = new Map<Element, RevisionListEntry>();
  for (const revision of revisions) {
    for (const key of revision.constituentKeys) {
      const element = index.find(parseConstituentKey(key));
      if (element) revisionOf.set(element, revision);
    }
  }
  const outOfRange = (element: Element | undefined) => {
    const revision = element && revisionOf.get(element);
    return !!revision && options.outOfRange.has(revision.id);
  };
  const rejected = (element: Element | undefined) => {
    const revision = element && revisionOf.get(element);
    return !!revision && decisions.get(revision.id) === 'reject';
  };

  /** Status of content wrapped in (or a paragraph marked by) this markup element. */
  const statusOf = (markup: Element | undefined): Status => {
    if (!markup) return 'both';
    const revision = revisionOf.get(markup);
    if (!revision || options.outOfRange.has(revision.id)) return 'skip';
    const side = MARKUP_SIDE[markup.localName!]!;
    const kept = (decisions.get(revision.id) === 'accept') === (side === 'E');
    if (!kept) return 'removed';
    return side === chosen ? 'native' : 'foreign';
  };

  /**
   * Properties in both versions of a container with an optional `…Change`: the Edited's are the
   * current ones, the Original's those stored in the change. Out-of-range formatting → `skip`.
   */
  const versions = (container: Element | undefined, changeName: string, oldName: string, skip: readonly string[]) => {
    const change = child(container, changeName);
    const current = props(container, skip);
    const old = change ? props(child(change, oldName), []) : current;
    return {
      change,
      skip: outOfRange(change),
      other: chosen === 'E' ? old : current,
      final: change && rejected(change) ? old : current,
      own: current,
    };
  };

  // Runs, in document order.
  const runs: RunUnit[] = [];
  const paragraphElements = elementsByName(document, 'p');
  for (const run of elementsByName(document, 'r')) {
    let markup: Element | undefined;
    let paragraph: Element | null = null;
    for (let parent = run.parentNode as Element | null; parent && parent.nodeType === parent.ELEMENT_NODE; parent = parent.parentNode as Element | null) {
      if (!markup && isW(parent, 'ins', 'del', 'moveFrom', 'moveTo')) markup = parent;
      if (isW(parent, 'p')) {
        paragraph = parent;
        break;
      }
    }
    let status = statusOf(markup);
    const rPr = child(run, 'rPr');
    const { change, skip, other, final, own } = versions(rPr, 'rPrChange', 'rPr', RUN_SKIP);
    if (skip) status = 'skip';
    const unit: RunUnit = { element: run, status, paragraph, text: descendants(run, TEXT), special: descendants(run, SPECIAL) };
    if (status === 'both') Object.assign(unit, { other: copy(other), final: copy(final) });
    if (status === 'native') unit.final = copy(final);
    // A foreign run with formatting changes of its own already has the chosen version's look.
    if (status === 'foreign') {
      if (change) unit.status = 'skip';
      else unit.other = own;
    }
    runs.push(unit);
  }

  // Paragraphs, in document order.
  const paragraphs: ParagraphUnit[] = [];
  for (const paragraph of paragraphElements) {
    const pPr = child(paragraph, 'pPr');
    const markRPr = child(pPr, 'rPr');
    const marker = children(markRPr).find((element) => isW(element, 'ins', 'del', 'moveFrom', 'moveTo'));
    let status = statusOf(marker);
    const paragraphVersions = versions(pPr, 'pPrChange', 'pPr', PARAGRAPH_SKIP);
    const markVersions = versions(markRPr, 'rPrChange', 'rPr', MARK_SKIP);
    if (paragraphVersions.skip) status = 'skip';
    const unit: ParagraphUnit = { element: paragraph, status, mark: {} };
    if (status === 'both') {
      Object.assign(unit, { other: copy(paragraphVersions.other), final: copy(paragraphVersions.final) });
      unit.mark = { other: copy(markVersions.other), final: copy(markVersions.final) };
    }
    if (status === 'native') {
      unit.final = copy(paragraphVersions.final);
      unit.mark = { final: copy(markVersions.final) };
    }
    if (status === 'foreign') {
      if (paragraphVersions.change) unit.status = 'skip';
      else unit.other = paragraphVersions.own;
      if (!markVersions.change) unit.mark = { other: markVersions.own };
    }
    paragraphs.push(unit);
  }

  const runMapping = learnMapping(runs);
  const paragraphMapping = learnMapping(paragraphs);
  const markMapping = learnMapping(paragraphs.map((unit) => ({ status: unit.status, ...unit.mark })));
  const actions: (() => void)[] = [];

  const byParagraph = (unit: RunUnit) => unit.paragraph;
  const bothRunsAround = nearestFinder(runs, (unit) => unit.status === 'both' && unit.text, byParagraph);
  const keptRunsAround = nearestFinder(runs, (unit) => (unit.status === 'both' || unit.status === 'native') && unit.text && !unit.special, byParagraph);
  runs.forEach((unit, at) => {
    if (unit.status !== 'foreign' || !unit.other) return;
    const other = unit.other.signature;
    const analog = bothRunsAround(at).find((candidate) => candidate.other!.signature === other);
    let target = analog?.final ?? runMapping.get(other);
    if (!target && !unit.special) target = keptRunsAround(at)[0]?.final;
    if (!target || target.signature === other) return;
    const look = target;
    actions.push(() => replaceProps(ensureChild(unit.element, 'rPr'), look.elements, [], RUN_SKIP));
  });

  const container = (unit: ParagraphUnit) => unit.element.parentNode;
  const bothParagraphsAround = nearestFinder(paragraphs, (unit) => unit.status === 'both', container);
  const keptParagraphsAround = nearestFinder(paragraphs, (unit) => unit.status === 'both' || unit.status === 'native', container);
  paragraphs.forEach((unit, at) => {
    if (unit.status !== 'foreign') return;
    const both = bothParagraphsAround(at);
    const neighbour = keptParagraphsAround(at)[0];
    if (unit.other) {
      const other = unit.other.signature;
      let target = both.find((candidate) => candidate.other!.signature === other)?.final ?? paragraphMapping.get(other);
      if (!target && neighbour?.final) {
        // A neighbour's numbering would make the paragraph a list item, or change its list.
        const numbering = unit.other.elements.filter((element) => isW(element, 'numPr'));
        const elements = neighbour.final.elements.filter((element) => !isW(element, 'numPr'));
        const before = elements.findIndex((element) => !isW(element, 'pStyle', 'keepNext', 'keepLines', 'pageBreakBefore', 'framePr', 'widowControl'));
        elements.splice(before === -1 ? elements.length : before, 0, ...numbering);
        target = { elements, signature: elements.map(signatureOf).join('') };
      }
      if (target && target.signature !== other) {
        const look = target;
        actions.push(() => replaceProps(ensureChild(unit.element, 'pPr'), look.elements, [], PARAGRAPH_SKIP));
      }
    }
    if (unit.mark.other) {
      const other = unit.mark.other.signature;
      const target =
        both.find((candidate) => candidate.mark.other?.signature === other)?.mark.final ??
        markMapping.get(other) ??
        runMapping.get(other) ??
        neighbour?.mark.final;
      if (target && target.signature !== other) {
        const look = target;
        actions.push(() => {
          const markRPr = child(child(unit.element, 'pPr'), 'rPr');
          if (markRPr) replaceProps(markRPr, look.elements, MARK_SKIP.slice(0, 4), ['rPrChange']);
        });
      }
    }
  });

  return () => {
    for (const action of actions) action();
  };
}
