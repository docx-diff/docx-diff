import 'fake-indexeddb/auto';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { createStore } from 'idb-keyval';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_COMPARE_SETTINGS } from '../model/equivalence';
import { ReviewStore, sha256, type ReviewState } from '../storage/reviewStore';
import type { Comparison } from './useComparison';
import { useAutoSave, useReviewStorage } from './useReviewStorage';

let dbCount = 0;
function newStore(): ReviewStore {
  return new ReviewStore(createStore(`autosave-${dbCount++}`, 'reviews'));
}

const STATE: ReviewState = {
  range: { mode: 'off', endPoint: null },
  decisions: {},
  comments: {},
  formattingChoice: 'edited',
  compareSettings: DEFAULT_COMPARE_SETTINGS,
  formattingGroupExpanded: false,
  edits: [],
};

function comparison(original = 'original', edited = 'edited'): Comparison {
  return {
    original: new File([original], 'a.docx'),
    edited: new File([edited], 'b.docx'),
    originalName: 'a.docx',
    editedName: 'b.docx',
  } as Comparison;
}

function AutoSave(props: { store: ReviewStore; comparison: Comparison | null; state: ReviewState; onFailure?: () => void }) {
  useAutoSave(props.store, props.comparison, '13.0.0', props.state, props.onFailure ?? (() => {}));
  return null;
}

describe('useAutoSave', () => {
  afterEach(cleanup);

  it('saves the files and the state once compared, then each change of state', async () => {
    const store = newStore();
    const current = comparison();
    const view = render(<AutoSave store={store} comparison={current} state={STATE} />);
    await waitFor(async () => expect(await store.load()).not.toBeNull());
    const saved = (await store.load())!;
    expect(saved).toMatchObject({ engineVersion: '13.0.0', original: { name: 'a.docx' }, edited: { name: 'b.docx' }, ...STATE });
    expect(saved.original.sha256).toBe(await sha256(new TextEncoder().encode('original').buffer as ArrayBuffer));

    const next = { ...STATE, decisions: { x: 'rejected' as const } };
    view.rerender(<AutoSave store={store} comparison={current} state={next} />);
    await waitFor(async () => expect((await store.load())?.decisions).toEqual({ x: 'rejected' }));
  });

  it('saves nothing without a comparison', async () => {
    const store = newStore();
    render(<AutoSave store={store} comparison={null} state={STATE} />);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(await store.load()).toBeNull();
  });

  it('reports a failed write', async () => {
    const full = new ReviewStore(() => Promise.reject(new DOMException('Full.', 'QuotaExceededError')));
    const onFailure = vi.fn();
    render(<AutoSave store={full} comparison={comparison()} state={STATE} onFailure={onFailure} />);
    await waitFor(() => expect(onFailure).toHaveBeenCalled());
  });
});

describe('useAutoSave after a write that throws', () => {
  afterEach(cleanup);

  it('reports it and keeps saving', async () => {
    const store = newStore();
    const onFailure = vi.fn();
    const broken = comparison();
    // As when the file cannot be read again, or hashing is unavailable.
    broken.original.arrayBuffer = () => Promise.reject(new Error('unreadable'));
    const view = render(<AutoSave store={store} comparison={broken} state={STATE} onFailure={onFailure} />);
    await waitFor(() => expect(onFailure).toHaveBeenCalled());
    view.rerender(<AutoSave store={store} comparison={comparison('other')} state={STATE} onFailure={onFailure} />);
    await waitFor(async () => expect(await store.load()).not.toBeNull());
  });
});

function Storage({ open }: { open: () => Promise<ReviewStore | null> }) {
  const { storage } = useReviewStorage(open);
  return <p data-testid="storage">{storage.status === 'ready' ? `ready ${storage.saved?.original.name ?? 'none'}` : storage.status}</p>;
}

describe('useReviewStorage', () => {
  afterEach(cleanup);

  it('reads the saved review once the store is open', async () => {
    const store = newStore();
    const original = new TextEncoder().encode('o').buffer as ArrayBuffer;
    await store.save({
      schemaVersion: 1,
      engineVersion: '13.0.0',
      original: { name: 'saved.docx', sha256: await sha256(original), bytes: original },
      edited: { name: 'e.docx', sha256: await sha256(original), bytes: original },
      ...STATE,
      savedAt: new Date().toISOString(),
    });
    render(<Storage open={async () => store} />);
    expect(screen.getByTestId('storage').textContent).toBe('opening');
    await waitFor(() => expect(screen.getByTestId('storage').textContent).toBe('ready saved.docx'));
  });

  it('is unavailable when the store cannot be opened', async () => {
    render(<Storage open={async () => null} />);
    await waitFor(() => expect(screen.getByTestId('storage').textContent).toBe('unavailable'));
  });
});
