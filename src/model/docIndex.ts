// Index of the rendered redline HTML: block order, which blocks belong to the Original, note
// references and which revisions the HTML shows (PRD §7.2 step 5, §7.5). The redline XML has no
// anchor ids, so positions come from here. Runs on the main thread with the native DOMParser.
import { revisionIdFromAuthor } from '../engine/tagRedline';

export type BlockScope = 'body' | 'fn' | 'en';

export interface IndexBlock {
  /** The block's `data-anchor`, equal to a revision's `affectedAnchors[].unid`. */
  unid: string;
  scope: BlockScope;
  /** The block is visible in the left panel: not wholly inserted or moved-to content. */
  inOriginal: boolean;
  /** The block is visible in the right panel: not wholly deleted or moved-from content. */
  inEdited: boolean;
  inTable: boolean;
  /** For note blocks: the note id (`fn-<id>` / `en-<id>` in the HTML). */
  noteId?: string;
}

/** A note reference in the body, and the insertion or deletion it sits in, if any. */
export interface NoteReference {
  /** Unid of the body block that contains the reference. */
  block: string;
  /** `ins`/`del` when the reference is inserted or deleted content, else `null`. */
  change: 'ins' | 'del' | null;
  /** The revision of that insertion or deletion. */
  revisionId: string | null;
}

export interface DocIndex {
  /** Every element with `data-anchor`, in document order. */
  blocks: IndexBlock[];
  blockByUnid: Map<string, IndexBlock>;
  /** Unids of the Original's body paragraphs, in order; a paragraph's position is its index here. */
  bodyParagraphs: string[];
  /**
   * `noteKey(scope, noteId)` → unid of the body block that references the note; the first one in
   * document order when several do, so a note is outside the range only when all of its
   * references are.
   */
  noteRefs: Map<string, string>;
  /** `noteKey(scope, noteId)` → every reference to the note, in document order. */
  noteReferences: Map<string, NoteReference[]>;
  /** Revision id → the phrases of its elements' `title` attributes (formatting descriptions), without duplicates. */
  revisionTitles: Map<string, string[]>;
  /** Ids of the revisions that have at least one element in the HTML. */
  revisionsInHtml: Set<string>;
  /**
   * `adjacencyKey(a, b)` of every two revisions whose content touches in a paragraph's text, with
   * at most whitespace of unchanged text between them (a deletion right before an insertion, …).
   */
  adjacentRevisions: Set<string>;
}

export function adjacencyKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function noteKey(scope: 'fn' | 'en', noteId: string): string {
  return `${scope}:${noteId}`;
}

export type HtmlParser = (html: string) => Document;

const parseWithDomParser: HtmlParser = (html) => new DOMParser().parseFromString(html, 'text/html');

/** Content that is not in the Original (hidden in the left panel), and the class of an inserted paragraph mark. */
const NOT_ORIGINAL = { content: 'ins, .rev-move-to', paragraphMark: 'rev-para-ins' };
/** Content that is not in the Edited document (hidden in the right panel), and the class of a deleted paragraph mark. */
const NOT_EDITED = { content: 'del, .rev-move-from', paragraphMark: 'rev-para-del' };
/** Rendering aids and list labels (numbering, not text). */
const NOT_TEXT = '.rev-para-mark-del, .fn-backref, .en-backref, [data-list-marker]';
/** `NodeFilter.SHOW_TEXT`; `NodeFilter` is not a global when the document comes from jsdom in Node tests. */
const SHOW_TEXT = 0x4;

export function buildDocIndex(html: string, parse: HtmlParser = parseWithDomParser): DocIndex {
  const document = parse(html);
  const blocks: IndexBlock[] = [];
  for (const element of document.querySelectorAll<HTMLElement>('[data-anchor]')) {
    const block: IndexBlock = {
      unid: element.dataset.anchor!,
      scope: scopeOf(element),
      inOriginal: isInVersion(element, NOT_ORIGINAL),
      inEdited: isInVersion(element, NOT_EDITED),
      inTable: element.closest('table') !== null,
    };
    const note = element.closest('li[id^="fn-"], li[id^="en-"]');
    if (note && block.scope !== 'body') block.noteId = note.id.slice(3);
    blocks.push(block);
  }

  const noteRefs = new Map<string, string>();
  const noteReferences = new Map<string, NoteReference[]>();
  for (const ref of document.querySelectorAll<HTMLElement>('a.footnote-ref[data-footnote-id], a.endnote-ref')) {
    const isFootnote = ref.classList.contains('footnote-ref');
    const noteId = isFootnote ? ref.dataset.footnoteId! : (ref.getAttribute('href') ?? '').replace(/^#en-/, '');
    const block = ref.closest<HTMLElement>('[data-anchor]');
    if (!block || !noteId) continue;
    const key = noteKey(isFootnote ? 'fn' : 'en', noteId);
    if (!noteRefs.has(key)) noteRefs.set(key, block.dataset.anchor!);
    const change = ref.closest('ins, del');
    noteReferences.set(key, [
      ...(noteReferences.get(key) ?? []),
      {
        block: block.dataset.anchor!,
        change: change ? (change.localName as 'ins' | 'del') : null,
        revisionId: revisionIdFromAuthor(change?.getAttribute('data-author')),
      },
    ]);
  }

  const revisionTitles = new Map<string, string[]>();
  const revisionsInHtml = new Set<string>();
  for (const element of document.querySelectorAll<HTMLElement>('[data-author^="rev:"]')) {
    const revisionId = revisionIdFromAuthor(element.dataset.author)!;
    revisionsInHtml.add(revisionId);
    const title = element.getAttribute('title');
    if (!title) continue;
    const phrases = revisionTitles.get(revisionId) ?? [];
    for (const phrase of title.split(',').map((p) => p.trim())) {
      if (phrase && !phrases.includes(phrase)) phrases.push(phrase);
    }
    revisionTitles.set(revisionId, phrases);
  }

  return {
    adjacentRevisions: findAdjacentRevisions(document),
    blocks,
    blockByUnid: new Map(blocks.map((block) => [block.unid, block])),
    bodyParagraphs: blocks.filter((b) => b.scope === 'body' && b.inOriginal).map((b) => b.unid),
    noteRefs,
    noteReferences,
    revisionTitles,
    revisionsInHtml,
  };
}

/** Walks the text in document order and records revisions whose content touches within a block. */
function findAdjacentRevisions(document: Document): Set<string> {
  const adjacent = new Set<string>();
  let block: Element | null = null;
  let previous: string | null = null;
  const walker = document.createTreeWalker(document.body ?? document.documentElement, SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    const text = node.textContent ?? '';
    if (!parent || !text || parent.closest(NOT_TEXT)) continue;
    const nodeBlock = parent.closest('[data-anchor]');
    if (nodeBlock !== block) {
      block = nodeBlock;
      previous = null;
    }
    const revision = revisionIdFromAuthor(parent.closest('ins, del')?.getAttribute('data-author'));
    if (revision === null) {
      if (text.trim()) previous = null;
      continue;
    }
    if (previous !== null && previous !== revision) adjacent.add(adjacencyKey(previous, revision));
    previous = revision;
  }
  return adjacent;
}

/** From `data-source-anchor-id`, e.g. `p:fn:…` → `fn`. */
function scopeOf(element: HTMLElement): BlockScope {
  const scope = (element.dataset.sourceAnchorId ?? '').split(':')[1];
  return scope === 'fn' || scope === 'en' ? scope : 'body';
}

/**
 * A block belongs to a version unless all of its text is content the version lacks (for the
 * Original: inserted or moved-to content). An empty block belongs to it unless its paragraph
 * mark is missing from it (for the Original: inserted).
 */
function isInVersion(block: HTMLElement, missing: { content: string; paragraphMark: string }): boolean {
  let hasText = false;
  const walker = block.ownerDocument.createTreeWalker(block, SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent?.trim()) continue;
    const parent = node.parentElement;
    if (!parent || parent.closest(NOT_TEXT)) continue;
    hasText = true;
    if (!parent.closest(missing.content)) return true;
  }
  return !hasText && !block.classList.contains(missing.paragraphMark);
}
