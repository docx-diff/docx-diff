// Generates a synthetic ~300-page document pair (about 90,000 words) for performance checks.
// Deterministic: the same seed gives the same pair.
import { minimalDocx } from './minimal-docx';

/** Small seeded PRNG (mulberry32). */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LETTERS = 'aábcdeéfghiíjklmnoóöőprstuúüűvz';

export interface BigPairOptions {
  paragraphs?: number;
  wordsPerParagraph?: number;
  seed?: number;
}

export interface BigPair {
  original: Uint8Array;
  edited: Uint8Array;
  words: number;
}

/**
 * Original: `paragraphs` paragraphs of about `wordsPerParagraph` words. Edited: per paragraph, a
 * word replaced (30 %), a word inserted (10 %) or deleted (10 %); 1 % of paragraphs deleted and
 * 1 % new paragraphs inserted.
 */
export function bigPair({ paragraphs = 3000, wordsPerParagraph = 30, seed = 1 }: BigPairOptions = {}): BigPair {
  const next = random(seed);
  const pick = <T>(values: readonly T[]): T => values[Math.floor(next() * values.length)]!;
  const vocabulary = Array.from({ length: 3000 }, () =>
    Array.from({ length: 2 + Math.floor(next() * 9) }, () => pick([...LETTERS])).join(''),
  );
  const sentence = (count: number) => {
    const words = Array.from({ length: count }, () => pick(vocabulary));
    return words.join(' ') + '.';
  };

  const original: string[] = [];
  const edited: string[] = [];
  let words = 0;
  for (let p = 0; p < paragraphs; p++) {
    const count = Math.max(5, Math.round(wordsPerParagraph * (0.5 + next())));
    const text = sentence(count);
    original.push(text);
    words += count;

    if (next() < 0.01) continue;
    const tokens = text.split(' ');
    const at = Math.floor(next() * tokens.length);
    const roll = next();
    if (roll < 0.3) tokens[at] = pick(vocabulary);
    else if (roll < 0.4) tokens.splice(at, 0, pick(vocabulary));
    else if (roll < 0.5 && tokens.length > 1) tokens.splice(at, 1);
    edited.push(tokens.join(' '));
    if (next() < 0.01) edited.push(sentence(20));
  }
  return { original: minimalDocx(original), edited: minimalDocx(edited), words };
}
