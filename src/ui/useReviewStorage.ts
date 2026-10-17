import { useCallback, useEffect, useRef, useState } from 'react';
import { openReviewStore, sha256, type ReviewState, type ReviewStore, type SavedReview } from '../storage/reviewStore';
import type { Comparison } from './useComparison';

/** How long the reviewing state must stay unchanged before it is saved. */
export const SAVE_DELAY_MS = 300;

export type ReviewStorage =
  | { status: 'opening' }
  /** `saved` is the review saved by an earlier visit, read once when the store opened. */
  | { status: 'ready'; store: ReviewStore; saved: SavedReview | null }
  | { status: 'unavailable' };

/**
 * Opens the review store on mount and reads the saved review. `markUnavailable` is for a write
 * that failed later (e.g. the quota): the app then keeps working without saving (FR-50).
 */
export function useReviewStorage(open: () => Promise<ReviewStore | null> = openReviewStore): {
  storage: ReviewStorage;
  markUnavailable: () => void;
} {
  const [storage, setStorage] = useState<ReviewStorage>({ status: 'opening' });
  useEffect(() => {
    let active = true;
    void (async () => {
      const store = await open();
      const saved = store ? await store.load() : null;
      if (active) setStorage(store ? { status: 'ready', store, saved } : { status: 'unavailable' });
    })();
    return () => {
      active = false;
    };
    // `open` is a factory for tests; a new one on each render must not reopen the store.
  }, []);
  const markUnavailable = useCallback(() => setStorage({ status: 'unavailable' }), []);
  return { storage, markUnavailable };
}

/**
 * Saves the review: both files and the reviewing state once a comparison is done, then the
 * reviewing state whenever it changes, `SAVE_DELAY_MS` after the last change (and at once when the
 * page is hidden). Writes run one after another. A failed write calls `onFailure`.
 */
export function useAutoSave(
  store: ReviewStore | null,
  comparison: Comparison | null,
  engineVersion: string | null,
  state: ReviewState,
  onFailure: () => void,
): void {
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const latest = useRef({ state, onFailure });
  latest.current = { state, onFailure };
  /** The comparison whose files are saved (or being saved), and their hashes. */
  const saved = useRef<{ comparison: Comparison; hashes: Promise<{ original: string; edited: string }> } | null>(null);

  const enqueue = useCallback((write: () => Promise<boolean>) => {
    queue.current = queue.current.then(write).then((ok) => {
      if (!ok) latest.current.onFailure();
    });
  }, []);

  useEffect(() => {
    if (!store || !comparison || engineVersion === null) return;
    const files = Promise.all([comparison.original.arrayBuffer(), comparison.edited.arrayBuffer()]);
    const hashes = files.then(async ([original, edited]) => ({ original: await sha256(original), edited: await sha256(edited) }));
    saved.current = { comparison, hashes };
    enqueue(async () => {
      const [[original, edited], hash] = await Promise.all([files, hashes]);
      const ok = await store.save({
        schemaVersion: 1,
        engineVersion,
        original: { name: comparison.originalName, sha256: hash.original, bytes: original },
        edited: { name: comparison.editedName, sha256: hash.edited, bytes: edited },
        ...latest.current.state,
        savedAt: new Date().toISOString(),
      });
      // Don't leave the previous review behind to be offered for the wrong files.
      if (!ok) await store.discard();
      return ok;
    });
  }, [store, comparison, engineVersion, enqueue]);

  useEffect(() => {
    const target = saved.current;
    if (!store || !target || target.comparison !== comparison) return;
    const write = () => enqueue(async () => store.saveState(state, await target.hashes));
    let pending = true;
    const timer = setTimeout(() => {
      pending = false;
      write();
    }, SAVE_DELAY_MS);
    const flush = () => {
      if (!pending) return;
      pending = false;
      clearTimeout(timer);
      write();
    };
    window.addEventListener('pagehide', flush);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pagehide', flush);
    };
  }, [store, comparison, state, enqueue]);
}
