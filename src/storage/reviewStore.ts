// The saved review (FR-46 – FR-50): one review at a time in IndexedDB, with both input files, so
// that reopening the page can compare them again and restore the decisions. Every call is wrapped:
// storage that fails (private window, quota, blocked) only means the review is not remembered.
import { createStore, del, delMany, getMany, set, setMany, update, type UseStore } from 'idb-keyval';
import type { FormattingChoice } from '../engine/types';
import type { Decision } from '../model/decisions';
import type { BlockScope } from '../model/docIndex';
import { DEFAULT_COMPARE_SETTINGS, type CompareSettings } from '../model/equivalence';
import type { BlockEdit, Segment } from '../model/paragraphEdit';
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
  /** The reviewer's comments by item id (FR-27b). */
  comments: Record<string, string>;
  formattingChoice: FormattingChoice;
  /** Which changes are ignored. */
  compareSettings: CompareSettings;
  formattingGroupExpanded: boolean;
  /**
   * The inline edits: every block an edit touched, also one reverted since (its `nextId` keeps
   * item ids from being reused). Replayed on resume (docs/architecture.md, "Inline edits").
   */
  edits: BlockEdit[];
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

/** The review without the files' bytes: rewritten on every change while reviewing. */
const KEY = 'current-review';
/** The files' bytes: written once per comparison. */
const FILES_KEY = 'current-review-files';
const PROBE_KEY = 'probe';

type StoredReview = Omit<SavedReview, 'original' | 'edited'> & {
  original: Omit<SavedFile, 'bytes'>;
  edited: Omit<SavedFile, 'bytes'>;
};
interface StoredFiles {
  original: ArrayBuffer;
  edited: ArrayBuffer;
}

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

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
// Not `instanceof`: a structured clone can come from another realm.
const isArrayBuffer = (value: unknown): value is ArrayBuffer => Object.prototype.toString.call(value) === '[object ArrayBuffer]';

function isStoredReview(value: unknown): value is StoredReview {
  const isFile = (file: unknown) => isObject(file) && typeof file.name === 'string' && typeof file.sha256 === 'string';
  return isObject(value) && value.schemaVersion === 1 && typeof value.engineVersion === 'string' && isFile(value.original) && isFile(value.edited);
}

const isString = (value: unknown): value is string => typeof value === 'string';
const SCOPES: readonly unknown[] = ['body', 'fn', 'en'] satisfies BlockScope[];

/** The reviewer's bold/italic of a segment: absent in records written before it existed. */
function isFormat(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isObject(value)) return false;
  const isFlag = (flag: unknown) => flag === undefined || typeof flag === 'boolean';
  const isId = (id: unknown) => id === undefined || isString(id);
  return isFlag(value.bold) && isFlag(value.italic) && isId(value.itemId) && isId(value.revisionId) && (value.itemId === undefined) === (value.revisionId === undefined);
}

function isSegment(value: unknown): value is Segment {
  if (!isObject(value)) return false;
  switch (value.kind) {
    case 'equal':
      return isString(value.text) && isFormat(value.format);
    case 'del':
      return isString(value.text) && isString(value.itemId) && isString(value.revisionId) && value.format === undefined;
    case 'ins':
      return isString(value.text) && isString(value.itemId) && isString(value.revisionId) && isFormat(value.format);
    case 'object': {
      const owner = value.owner;
      return (
        isString(value.key) &&
        (owner === undefined || (isObject(owner) && (owner.change === 'del' || owner.change === 'ins') && isString(owner.itemId) && isString(owner.revisionId)))
      );
    }
    default:
      return false;
  }
}

function isBlockEdit(value: unknown): value is BlockEdit {
  const isSegments = (segments: unknown) => Array.isArray(segments) && segments.every(isSegment);
  return (
    isObject(value) &&
    isString(value.unid) &&
    SCOPES.includes(value.scope) &&
    isSegments(value.original) &&
    isSegments(value.current) &&
    Number.isSafeInteger(value.nextId) &&
    (value.nextId as number) >= 1
  );
}

/**
 * The reviewing state of a stored record, with anything malformed replaced by its default (a
 * record written by another version of the app, or edited by hand): only `accepted`/`rejected`
 * decisions, text comments, known compare settings over the defaults, a range of a known shape
 * (whether it fits the document is checked after the compare, `restoredRange`), well-formed edit
 * records (whether they fit the document is checked by the replay, `EditSession.restore`).
 */
function sanitizeState(stored: StoredReview): ReviewState {
  const decisions: Record<string, Decision> = {};
  if (isObject(stored.decisions)) {
    for (const [id, decision] of Object.entries(stored.decisions)) {
      if (decision === 'accepted' || decision === 'rejected') decisions[id] = decision;
    }
  }
  const comments: Record<string, string> = {};
  if (isObject(stored.comments)) {
    for (const [id, comment] of Object.entries(stored.comments)) if (typeof comment === 'string') comments[id] = comment;
  }
  const compareSettings = { ...DEFAULT_COMPARE_SETTINGS };
  if (isObject(stored.compareSettings)) {
    for (const key of Object.keys(DEFAULT_COMPARE_SETTINGS) as (keyof CompareSettings)[]) {
      const value = stored.compareSettings[key];
      if (typeof value === 'boolean') compareSettings[key] = value;
    }
  }
  const range: unknown = stored.range;
  const validRange =
    isObject(range) &&
    ((range.mode === 'off' && range.endPoint === null) || ((range.mode === 'auto' || range.mode === 'manual') && typeof range.endPoint === 'number'));
  return {
    decisions,
    comments,
    compareSettings,
    range: validRange ? (range as RangeState) : { mode: 'off', endPoint: null },
    formattingChoice: stored.formattingChoice === 'original' ? 'original' : 'edited',
    formattingGroupExpanded: stored.formattingGroupExpanded === true,
    edits: Array.isArray(stored.edits) ? stored.edits.filter(isBlockEdit) : [],
  };
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
      const [stored, files] = await getMany<unknown>([KEY, FILES_KEY], this.store);
      if (!isStoredReview(stored) || !isObject(files) || !isArrayBuffer(files.original) || !isArrayBuffer(files.edited)) return null;
      return {
        schemaVersion: 1,
        engineVersion: stored.engineVersion,
        original: { name: stored.original.name, sha256: stored.original.sha256, bytes: files.original },
        edited: { name: stored.edited.name, sha256: stored.edited.sha256, bytes: files.edited },
        savedAt: typeof stored.savedAt === 'string' ? stored.savedAt : '',
        ...sanitizeState(stored),
      };
    } catch {
      return null;
    }
  }

  /** Replaces the saved review (a new comparison). Both records are written in one transaction. */
  async save(review: SavedReview): Promise<boolean> {
    const { original, edited, ...rest } = review;
    const stored: StoredReview = {
      ...rest,
      original: { name: original.name, sha256: original.sha256 },
      edited: { name: edited.name, sha256: edited.sha256 },
    };
    const files: StoredFiles = { original: original.bytes, edited: edited.bytes };
    try {
      await setMany(
        [
          [KEY, stored],
          [FILES_KEY, files],
        ],
        this.store,
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Updates the reviewing state of the saved review, if it is still the one for `original` and
   * `edited` (by hash); otherwise leaves it alone. The files are not rewritten.
   */
  async saveState(state: ReviewState, files: { original: string; edited: string }): Promise<boolean> {
    try {
      await update<unknown>(
        KEY,
        (old) =>
          isStoredReview(old) && old.original.sha256 === files.original && old.edited.sha256 === files.edited
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
      await delMany([KEY, FILES_KEY], this.store);
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
