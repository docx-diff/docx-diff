// The saved review (FR-46 – FR-50): one review at a time in IndexedDB, with both input files, so
// that reopening the page can compare them again and restore the decisions. Every call is wrapped:
// storage that fails (private window, quota, blocked) only means the review is not remembered.
import { createStore, del, get, set, update, type UseStore } from 'idb-keyval';
import type { FormattingChoice } from '../engine/types';
import type { Decision } from '../model/decisions';
import type { CompareSettings } from '../model/equivalence';
import type { RangeState } from '../model/range';

export interface SavedFile {
  name: string;
  sha256: string;
  bytes: ArrayBuffer;
}

/** The part of the review that changes while reviewing (saved again after every change). */
export interface ReviewState {
  range: RangeState;
  decisions: Record<string, Decision>;
  formattingChoice: FormattingChoice;
  /** Which changes are ignored. */
  compareSettings: CompareSettings;
  formattingGroupExpanded: boolean;
}

export interface SavedReview extends ReviewState {
  schemaVersion: 1;
  /** The `docxodus` package version that compared the files: revision ids depend on it (FR-49). */
  engineVersion: string;
  original: SavedFile;
  edited: SavedFile;
  /** ISO date. */
  savedAt: string;
}

const KEY = 'current-review';
const PROBE_KEY = 'probe';

/** SHA-256 of the bytes, as lowercase hex. */
export async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The saved files' names, hashes and the engine version, checked before decisions are restored. */
export async function savedFilesMatch(review: SavedReview, engineVersion: string): Promise<'match' | 'files' | 'engine'> {
  const [original, edited] = await Promise.all([sha256(review.original.bytes), sha256(review.edited.bytes)]);
  if (original !== review.original.sha256 || edited !== review.edited.sha256) return 'files';
  return review.engineVersion === engineVersion ? 'match' : 'engine';
}

function isSavedReview(value: unknown): value is SavedReview {
  if (typeof value !== 'object' || value === null) return false;
  const review = value as Partial<SavedReview>;
  const isFile = (file: Partial<SavedFile> | undefined) =>
    !!file && typeof file.name === 'string' && typeof file.sha256 === 'string' && // Not `instanceof`: a structured clone can come from another realm.
    Object.prototype.toString.call(file.bytes) === '[object ArrayBuffer]';
  return (
    review.schemaVersion === 1 &&
    typeof review.engineVersion === 'string' &&
    isFile(review.original) &&
    isFile(review.edited) &&
    typeof review.range === 'object' &&
    typeof review.decisions === 'object' &&
    typeof review.compareSettings === 'object'
  );
}

/**
 * The review store. Methods never throw: a failed write returns `false` (the caller then treats
 * storage as unavailable), a failed read returns `null`.
 */
export class ReviewStore {
  constructor(private readonly store: UseStore) {}

  /** The saved review, or `null` when there is none, it cannot be read, or it has another schema. */
  async load(): Promise<SavedReview | null> {
    try {
      const value: unknown = await get(KEY, this.store);
      return isSavedReview(value) ? value : null;
    } catch {
      return null;
    }
  }

  /** Replaces the saved review (a new comparison). */
  async save(review: SavedReview): Promise<boolean> {
    try {
      await set(KEY, review, this.store);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Updates the reviewing state of the saved review, if it is still the one for `original` and
   * `edited` (by hash); otherwise leaves it alone.
   */
  async saveState(state: ReviewState, files: { original: string; edited: string }): Promise<boolean> {
    try {
      await update<unknown>(
        KEY,
        (old) =>
          isSavedReview(old) && old.original.sha256 === files.original && old.edited.sha256 === files.edited
            ? { ...old, ...state, savedAt: new Date().toISOString() }
            : old,
        this.store,
      );
      return true;
    } catch {
      return false;
    }
  }

  async discard(): Promise<boolean> {
    try {
      await del(KEY, this.store);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Opens the review store and checks that it can be written (a probe write and delete), or returns
 * `null` when IndexedDB is unavailable, e.g. blocked in a private window.
 */
export async function openReviewStore(store?: UseStore): Promise<ReviewStore | null> {
  try {
    if (typeof indexedDB === 'undefined') return null;
    const useStore = store ?? createStore('docx-diff', 'reviews');
    await set(PROBE_KEY, 1, useStore);
    await del(PROBE_KEY, useStore);
    return new ReviewStore(useStore);
  } catch {
    return null;
  }
}
