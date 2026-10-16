// Changes that don't change the text in a way the reviewer cares about. For each text change the
// paragraph text is taken twice from the rendered HTML: in the Original's state, and with only
// that change applied. Then:
// - identical text (e.g. a word split over runs with different fonts in one version and a single
//   run in the other: the engine tokenizes per run and reports a deletion plus an insertion) →
//   the change is relabelled as a formatting change;
// - text equal after the compare settings' normalizations (quote style, dashes, whitespace) →
//   the change is ignored: not highlighted, not listed, and exported as in the Edited document.
import type { ChangeItem } from './changes';

export interface CompareSettings {
  /** Straight, curly, low and angle quotes are the same (single and double kept apart); so are "..." and "…". */
  ignoreQuotes: boolean;
  /** Hyphen, en dash, em dash, minus, … are the same. */
  ignoreDashes: boolean;
  /** Runs of spaces, tabs and line breaks are the same; paragraph breaks and empty paragraphs too. */
  ignoreWhitespace: boolean;
}

export const DEFAULT_COMPARE_SETTINGS: CompareSettings = {
  ignoreQuotes: true,
  ignoreDashes: true,
  ignoreWhitespace: true,
};

/** A text change's paragraph text in the Original's state and with only this change applied. */
export interface ItemText {
  before: string;
  after: string;
  /** The change adds or removes a paragraph mark, i.e. a paragraph break. */
  paragraphMark: boolean;
}

const SINGLE_QUOTES = /[‘’‚‛‹›`´]/g;
const DOUBLE_QUOTES = /[“”„‟«»〝〞]/g;
const DASHES = /[‐‑‒–—―−⸺⸻﹘﹣－]/g;

export function normalizeForComparison(text: string, settings: CompareSettings): string {
  let result = text.normalize('NFC');
  if (settings.ignoreQuotes) {
    result = result.replace(SINGLE_QUOTES, "'").replace(DOUBLE_QUOTES, '"').replace(/\u2026/g, '...');
  }
  if (settings.ignoreDashes) result = result.replace(DASHES, '-');
  if (settings.ignoreWhitespace) result = result.replace(/\s+/gu, ' ').trim();
  return result;
}

/** The change leaves the text exactly as it was (only formatting or run structure differ). */
export function isTextUnchanged(text: ItemText): boolean {
  return !text.paragraphMark && text.before.normalize('NFC') === text.after.normalize('NFC');
}

/** Text changes that the settings ignore. Formatting and moved items are never ignored. */
export function ignoredItems(
  items: readonly ChangeItem[],
  texts: ReadonlyMap<string, ItemText>,
  settings: CompareSettings,
): Set<string> {
  const ignored = new Set<string>();
  for (const item of items) {
    if (item.kind === 'formatting' || item.kind === 'moved') continue;
    const text = texts.get(item.id);
    if (!text || (text.paragraphMark && !settings.ignoreWhitespace)) continue;
    if (normalizeForComparison(text.before, settings) === normalizeForComparison(text.after, settings)) {
      ignored.add(item.id);
    }
  }
  return ignored;
}

/** Items whose text is unchanged become formatting items; returns the new list and their ids. */
export function relabelTextUnchanged(
  items: readonly ChangeItem[],
  texts: ReadonlyMap<string, ItemText>,
): { items: ChangeItem[]; relabelled: Set<string> } {
  const relabelled = new Set<string>();
  const result = items.map((item) => {
    const text = texts.get(item.id);
    if (item.kind === 'formatting' || item.kind === 'moved' || !text || !isTextUnchanged(text)) return item;
    relabelled.add(item.id);
    return {
      ...item,
      kind: 'formatting' as const,
      text: item.addedText || item.removedText,
      removedText: '',
      addedText: '',
      description: 'Same text, different formatting or run structure',
      wordDelta: { removed: 0, added: 0 },
    };
  });
  return { items: result, relabelled };
}

export type SettingName = keyof CompareSettings;
const SETTING_NAMES: SettingName[] = ['ignoreQuotes', 'ignoreDashes', 'ignoreWhitespace'];

/** The fewest settings under which two texts are equal (`[]`: equal as they are), or `null`. */
export function settingsMakingEqual(a: string, b: string): SettingName[] | null {
  const subsets: SettingName[][] = [[]];
  for (const name of SETTING_NAMES) for (const subset of [...subsets]) subsets.push([...subset, name]);
  subsets.sort((x, y) => x.length - y.length);
  for (const subset of subsets) {
    const settings = { ignoreQuotes: false, ignoreDashes: false, ignoreWhitespace: false };
    for (const name of subset) settings[name] = true;
    if (normalizeForComparison(a, settings) === normalizeForComparison(b, settings)) return subset;
  }
  return null;
}

/** One word or whitespace run at the edge of a replacement that both sides share. */
export interface CommonToken {
  removedLength: number;
  addedLength: number;
  /** Settings needed for this token and every token between it and the edge to count as equal. */
  needs: SettingName[];
}

/**
 * The words (and whitespace) a replacement's two sides share at the start and at the end, equal as
 * they are or under some compare settings: e.g. `szövegek "az` → `szutták szövegei “az` share
 * ` "az` / ` “az` with the quote setting. The engine compares whole tokens, so a quote attached
 * to an unchanged word comes along with the change next to it. Tokens are listed from the edge
 * inwards; the two edges never overlap.
 */
export function commonAffixes(removed: string, added: string): { prefix: CommonToken[]; suffix: CommonToken[] } {
  const tokenize = (text: string) => text.match(/\s+|[^\s]+/gu) ?? [];
  const a = tokenize(removed);
  const b = tokenize(added);
  const walk = (indexA: (i: number) => number, indexB: (i: number) => number, limitA: number, limitB: number) => {
    const tokens: CommonToken[] = [];
    let needs: SettingName[] = [];
    for (let i = 0; i < limitA && i < limitB; i++) {
      const x = a[indexA(i)]!;
      const y = b[indexB(i)]!;
      const required = settingsMakingEqual(x, y);
      if (required === null) break;
      needs = [...new Set([...needs, ...required])];
      tokens.push({ removedLength: x.length, addedLength: y.length, needs });
    }
    return tokens;
  };
  const prefix = walk((i) => i, (i) => i, a.length, b.length);
  const suffix = walk((i) => a.length - 1 - i, (i) => b.length - 1 - i, a.length - prefix.length, b.length - prefix.length);
  return { prefix, suffix };
}

/** Rendering aids that are not document text. */
const NOT_TEXT = '.rev-para-mark-del, .fn-backref, .en-backref, .rev-format-marker';
/** `NodeFilter.SHOW_TEXT` (not a global with jsdom in Node). */
const SHOW_TEXT = 0x4;

/**
 * Reads, from the decorated HTML (elements carry `data-change-id`), the text of each text change's
 * paragraphs before and after applying only that change. Other changes in the same paragraphs stay
 * in the Original's state. Paragraphs are joined with a line break.
 */
export function collectItemTexts(document: Document, items: readonly ChangeItem[]): Map<string, ItemText> {
  const blocks = new Map<string, HTMLElement>();
  for (const element of document.querySelectorAll<HTMLElement>('[data-anchor]')) blocks.set(element.dataset.anchor!, element);

  const texts = new Map<string, ItemText>();
  for (const item of items) {
    if (item.kind === 'formatting' || item.kind === 'moved') continue;
    const before: string[] = [];
    const after: string[] = [];
    let paragraphMark = false;
    for (const unid of item.anchors) {
      const block = blocks.get(unid);
      if (!block) continue;
      if (block.dataset.changeId === item.id && block.matches('.rev-para-del, .rev-para-ins')) paragraphMark = true;
      let blockBefore = '';
      let blockAfter = '';
      const walker = block.ownerDocument.createTreeWalker(block, SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const parent = node.parentElement;
        if (!parent || parent.closest(NOT_TEXT)) continue;
        const text = node.textContent ?? '';
        const change = parent.closest<HTMLElement>('ins, del');
        if (!change || !block.contains(change)) {
          blockBefore += text;
          blockAfter += text;
        } else if (change.localName === 'del') {
          blockBefore += text;
          if (change.dataset.changeId !== item.id) blockAfter += text;
        } else if (change.dataset.changeId === item.id) {
          blockAfter += text;
        }
      }
      before.push(blockBefore);
      after.push(blockAfter);
    }
    texts.set(item.id, { before: before.join('\n'), after: after.join('\n'), paragraphMark });
  }
  return texts;
}
