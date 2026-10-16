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
  inTable: boolean;
  /** For note blocks: the note id (`fn-<id>` / `en-<id>` in the HTML). */
  noteId?: string;
}

export interface DocIndex {
  /** Every element with `data-anchor`, in document order. */
  blocks: IndexBlock[];
  blockByUnid: Map<string, IndexBlock>;
  /** Unids of the Original's body paragraphs, in order; a paragraph's position is its index here. */
  bodyParagraphs: string[];
  /** `noteKey(scope, noteId)` → unid of the body block that references the note. */
  noteRefs: Map<string, string>;
  /** Revision id → the phrases of its elements' `title` attributes (formatting descriptions), without duplicates. */
  revisionTitles: Map<string, string[]>;
  /** Ids of the revisions that have at least one element in the HTML. */
  revisionsInHtml: Set<string>;
}

export function noteKey(scope: 'fn' | 'en', noteId: string): string {
  return `${scope}:${noteId}`;
}

export type HtmlParser = (html: string) => Document;

const parseWithDomParser: HtmlParser = (html) => new DOMParser().parseFromString(html, 'text/html');

/** Content that is not in the Original (hidden in the left panel). */
const NOT_ORIGINAL = 'ins, .rev-move-to';
/** Rendering aids that are not document text. */
const NOT_TEXT = '.rev-para-mark-del, .fn-backref, .en-backref';
/** `NodeFilter.SHOW_TEXT`; `NodeFilter` is not a global when the document comes from jsdom in Node tests. */
const SHOW_TEXT = 0x4;

export function buildDocIndex(html: string, parse: HtmlParser = parseWithDomParser): DocIndex {
  const document = parse(html);
  const blocks: IndexBlock[] = [];
  for (const element of document.querySelectorAll<HTMLElement>('[data-anchor]')) {
    const block: IndexBlock = {
      unid: element.dataset.anchor!,
      scope: scopeOf(element),
      inOriginal: isInOriginal(element),
      inTable: element.closest('table') !== null,
    };
    const note = element.closest('li[id^="fn-"], li[id^="en-"]');
    if (note && block.scope !== 'body') block.noteId = note.id.slice(3);
    blocks.push(block);
  }

  const noteRefs = new Map<string, string>();
  for (const ref of document.querySelectorAll<HTMLElement>('a.footnote-ref[data-footnote-id], a.endnote-ref')) {
    const isFootnote = ref.classList.contains('footnote-ref');
    const noteId = isFootnote ? ref.dataset.footnoteId! : (ref.getAttribute('href') ?? '').replace(/^#en-/, '');
    const block = ref.closest<HTMLElement>('[data-anchor]');
    if (block && noteId) noteRefs.set(noteKey(isFootnote ? 'fn' : 'en', noteId), block.dataset.anchor!);
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
    blocks,
    blockByUnid: new Map(blocks.map((block) => [block.unid, block])),
    bodyParagraphs: blocks.filter((b) => b.scope === 'body' && b.inOriginal).map((b) => b.unid),
    noteRefs,
    revisionTitles,
    revisionsInHtml,
  };
}

/** From `data-source-anchor-id`, e.g. `p:fn:…` → `fn`. */
function scopeOf(element: HTMLElement): BlockScope {
  const scope = (element.dataset.sourceAnchorId ?? '').split(':')[1];
  return scope === 'fn' || scope === 'en' ? scope : 'body';
}

/**
 * A block belongs to the Original unless all of its text is inserted (or moved-to) content.
 * An empty block belongs to the Original unless its paragraph mark is inserted.
 */
function isInOriginal(block: HTMLElement): boolean {
  let hasText = false;
  const walker = block.ownerDocument.createTreeWalker(block, SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent?.trim()) continue;
    const parent = node.parentElement;
    if (!parent || parent.closest(NOT_TEXT)) continue;
    hasText = true;
    if (!parent.closest(NOT_ORIGINAL)) return true;
  }
  return !hasText && !block.classList.contains('rev-para-ins');
}
