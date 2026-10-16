import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SMALL_HTML } from '../../test/small-html';
import type { CompareResult, ComparisonEngine, EngineVersion, ProgressEvent } from '../engine/types';
import { useComparison } from './useComparison';

/** A fake engine whose compare the test settles by hand. */
class FakeEngine implements ComparisonEngine {
  settle!: (result: CompareResult) => void;
  private readonly listeners = new Set<(event: ProgressEvent) => void>();
  init(): Promise<EngineVersion> {
    return Promise.reject(new Error('not used'));
  }
  version(): Promise<EngineVersion> {
    return Promise.reject(new Error('not used'));
  }
  compare(): Promise<CompareResult> {
    return new Promise((resolve) => {
      this.settle = resolve;
    });
  }
  exportDocx(): Promise<ArrayBuffer> {
    return Promise.reject(new Error('not used'));
  }
  onProgress(listener: (event: ProgressEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  dispose(): void {}
  progress(event: ProgressEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

function Harness({ engine, files }: { engine: ComparisonEngine; files: [File, File] }) {
  const state = useComparison(engine, ...files);
  return <p data-testid="state">{state.status === 'running' ? `running ${state.stage}` : state.status}</p>;
}

describe('useComparison', () => {
  afterEach(cleanup);

  it('reports compare progress, then the result, and ignores progress of later requests', async () => {
    const engine = new FakeEngine();
    const files: [File, File] = [new File(['a'], 'a.docx'), new File(['b'], 'b.docx')];
    render(<Harness engine={engine} files={files} />);
    await act(async () => {});
    act(() => engine.progress({ type: 'progress', stage: 'listing' }));
    expect(screen.getByTestId('state').textContent).toBe('running listing');

    await act(async () =>
      engine.settle({
        redline: new ArrayBuffer(0),
        revisions: [],
        html: SMALL_HTML,
        inputsHadRevisions: false,
        timings: { normalize: 0, checkInputs: 0, compare: 0, list: 0, tag: 0, render: 0 },
      }),
    );
    expect(screen.getByTestId('state').textContent).toBe('done');

    act(() => engine.progress({ type: 'progress', stage: 'exporting' }));
    expect(screen.getByTestId('state').textContent).toBe('done');
  });
});
