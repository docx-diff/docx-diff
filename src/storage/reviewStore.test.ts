import 'fake-indexeddb/auto';
import { createStore, type UseStore } from 'idb-keyval';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_COMPARE_SETTINGS } from '../model/equivalence';
import { openReviewStore, ReviewStore, savedFilesMatch, sha256, type ReviewState, type SavedReview } from './reviewStore';

let dbCount = 0;
let useStore: UseStore;
beforeEach(() => {
  // A fresh database per test.
  useStore = createStore(`test-${dbCount++}`, 'reviews');
});

function bytes(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

const STATE: ReviewState = {
  range: { mode: 'auto', endPoint: 12 },
  decisions: { a: 'accepted', b: 'rejected' },
  formattingChoice: 'edited',
  compareSettings: DEFAULT_COMPARE_SETTINGS,
  formattingGroupExpanded: false,
};

async function review(): Promise<SavedReview> {
  const original = bytes('original');
  const edited = bytes('edited');
  return {
    schemaVersion: 1,
    engineVersion: '13.0.0',
    original: { name: 'a.docx', sha256: await sha256(original), bytes: original },
    edited: { name: 'b.docx', sha256: await sha256(edited), bytes: edited },
    ...STATE,
    savedAt: new Date().toISOString(),
  };
}

/** A store whose writes fail the way a full disk does. */
const quotaStore: UseStore = (mode, callback) =>
  mode === 'readwrite' ? Promise.reject(new DOMException('The quota has been exceeded.', 'QuotaExceededError')) : useStore(mode, callback);

describe('sha256', () => {
  it('hashes as lowercase hex', async () => {
    expect(await sha256(bytes('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('ReviewStore', () => {
  it('has nothing saved at first', async () => {
    const store = (await openReviewStore(useStore))!;
    expect(store).not.toBeNull();
    expect(await store.load()).toBeNull();
  });

  it('saves, loads and discards the review', async () => {
    const store = (await openReviewStore(useStore))!;
    const saved = await review();
    expect(await store.save(saved)).toBe(true);
    const loaded = await store.load();
    expect(loaded).toMatchObject({ ...STATE, engineVersion: '13.0.0', original: { name: 'a.docx' }, edited: { name: 'b.docx' } });
    expect(new TextDecoder().decode(loaded!.original.bytes)).toBe('original');
    expect(await store.discard()).toBe(true);
    expect(await store.load()).toBeNull();
  });

  it('updates the reviewing state of the review of the same files only', async () => {
    const store = (await openReviewStore(useStore))!;
    const saved = await review();
    await store.save(saved);
    const next: ReviewState = { ...STATE, decisions: { c: 'accepted' }, range: { mode: 'off', endPoint: null }, formattingChoice: 'original' };
    expect(await store.saveState(next, { original: saved.original.sha256, edited: saved.edited.sha256 })).toBe(true);
    expect(await store.load()).toMatchObject(next);

    await store.saveState(STATE, { original: saved.edited.sha256, edited: saved.original.sha256 });
    expect(await store.load()).toMatchObject(next);
  });

  it('ignores a record with another schema', async () => {
    const store = (await openReviewStore(useStore))!;
    await store.save({ ...(await review()), schemaVersion: 2 } as unknown as SavedReview);
    expect(await store.load()).toBeNull();
  });

  it('reports a quota error as a failed write', async () => {
    const store = (await openReviewStore(useStore))!;
    await store.save(await review());
    const full = new ReviewStore(quotaStore);
    expect(await full.save(await review())).toBe(false);
    expect(await full.saveState(STATE, { original: 'x', edited: 'y' })).toBe(false);
    expect(await full.discard()).toBe(false);
    expect(await full.load()).not.toBeNull();
  });

  it('is unavailable when the database cannot be written', async () => {
    expect(await openReviewStore(quotaStore)).toBeNull();
    const blocked: UseStore = () => Promise.reject(new DOMException('The operation is insecure.', 'SecurityError'));
    expect(await openReviewStore(blocked)).toBeNull();
  });
});

describe('savedFilesMatch', () => {
  it('checks the hashes and the engine version', async () => {
    const saved = await review();
    expect(await savedFilesMatch(saved, '13.0.0')).toBe('match');
    expect(await savedFilesMatch(saved, '13.1.0')).toBe('engine');
    expect(await savedFilesMatch({ ...saved, edited: { ...saved.edited, bytes: bytes('changed') } }, '13.0.0')).toBe('files');
  });
});
