import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SMALL_HTML } from '../../test/small-html';
import type { CompareResult, ComparisonEngine, EngineVersion, ProgressListener, ProgressStage } from '../engine/types';
import { useComparison } from './useComparison';

/** A fake engine whose compare the test settles by hand. */
class FakeEngine implements ComparisonEngine {
  settle!: (result: CompareResult) => void;
  private listener: ProgressListener | undefined;
  init(): Promise<EngineVersion> {
    return Promise.reject(new Error('not used'));
  }
  version(): Promise<EngineVersion> {
    return Promise.reject(new Error('not used'));
  }
  compare(_original: ArrayBuffer, _edited: ArrayBuffer, onProgress?: ProgressListener): Promise<CompareResult> {
    this.listener = onProgress;
    return new Promise((resolve) => {
      this.settle = resolve;
    });
  }
  exportDocx(): Promise<ArrayBuffer> {
    return Promise.reject(new Error('not used'));
  }
  onFailure(): () => void {
    return () => {};
  }
  dispose(): void {}
  progress(stage: ProgressStage): void {
    this.listener?.({ type: 'progress', requestId: 1, stage });
  }
}

function Harness({ engine, files }: { engine: ComparisonEngine; files: [File, File] }) {
  const state = useComparison(engine, ...files);
  return <p data-testid="state">{state.status === 'running' ? `running ${state.stage}` : state.status}</p>;
}

describe('useComparison', () => {
  afterEach(cleanup);

  it('reports compare progress, then the result', async () => {
    const engine = new FakeEngine();
    const files: [File, File] = [new File(['a'], 'a.docx'), new File(['b'], 'b.docx')];
    render(<Harness engine={engine} files={files} />);
    await act(async () => {});
    act(() => engine.progress('listing'));
    expect(screen.getByTestId('state').textContent).toBe('running listing');

    await act(async () =>
      engine.settle({
        redline: new ArrayBuffer(0),
        revisions: [],
        html: SMALL_HTML,
        inputsHadRevisions: false,
        headings: { original: [], edited: [] },
        timings: { normalize: 0, checkInputs: 0, headings: 0, compare: 0, list: 0, tag: 0, render: 0 },
      }),
    );
    expect(screen.getByTestId('state').textContent).toBe('done');
  });
});
