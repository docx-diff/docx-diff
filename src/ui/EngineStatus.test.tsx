import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { CompareResult, ComparisonEngine, EngineVersion, ProgressListener, ProgressStage } from '../engine/types';
import { EngineStatus } from './EngineStatus';
import { useEngine } from './useEngine';

/** A fake engine whose `init` the test settles by hand. */
class FakeEngine implements ComparisonEngine {
  disposed = false;
  settle!: { resolve(version: EngineVersion): void; reject(error: Error): void };
  private listener: ProgressListener | undefined;
  private failureListener: ((error: Error) => void) | null = null;

  init(onProgress?: ProgressListener): Promise<EngineVersion> {
    this.listener = onProgress;
    return new Promise((resolve, reject) => {
      this.settle = {
        resolve: (version) => {
          this.listener = undefined;
          resolve(version);
        },
        reject,
      };
    });
  }
  version(): Promise<EngineVersion> {
    return Promise.reject(new Error('not used'));
  }
  compare(): Promise<CompareResult> {
    return Promise.reject(new Error('not used'));
  }
  exportDocx(): Promise<ArrayBuffer> {
    return Promise.reject(new Error('not used'));
  }
  onFailure(listener: (error: Error) => void): () => void {
    this.failureListener = listener;
    return () => {
      this.failureListener = null;
    };
  }
  dispose(): void {
    this.disposed = true;
  }
  progress(stage: ProgressStage): void {
    this.listener?.({ type: 'progress', requestId: 1, stage });
  }
  crash(message: string): void {
    this.failureListener?.(new Error(message));
  }
}

function Harness({ engines }: { engines: FakeEngine[] }) {
  const { state, retry } = useEngine(() => {
    const engine = new FakeEngine();
    engines.push(engine);
    return engine;
  });
  return <EngineStatus state={state} onRetry={retry} />;
}

describe('EngineStatus', () => {
  afterEach(cleanup);

  it('shows loading progress, then the engine version', async () => {
    const engines: FakeEngine[] = [];
    render(<Harness engines={engines} />);
    expect(screen.getByRole('status').textContent).toMatch(/Downloading the comparison engine… \d+\.\d s/);

    act(() => engines[0]!.progress('warming-up'));
    expect(screen.getByRole('status').textContent).toMatch(/Starting the comparison engine/);

    await act(async () => engines[0]!.settle.resolve({ docxodus: '13.0.0', dotnet: '10.0.12' }));
    expect(screen.getByRole('status').textContent).toBe('Engine ready · Docxodus 13.0.0');

    // Not shown on screen once ready (screen readers still get it).
    expect(screen.getByRole('status').className).toContain('visually-hidden');

    act(() => engines[0]!.progress('comparing'));
    expect(screen.getByRole('status').textContent).toBe('Engine ready · Docxodus 13.0.0');
  });

  it('shows the error with Retry, which starts a new engine', async () => {
    const engines: FakeEngine[] = [];
    render(<Harness engines={engines} />);
    await act(async () => engines[0]!.settle.reject(new Error('Failed to load WASM')));
    expect(screen.getByRole('status').textContent).toContain('Failed to load WASM');
    expect(screen.getByRole('status').className).not.toContain('visually-hidden');

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(engines[0]!.disposed).toBe(true);
    expect(engines).toHaveLength(2);
    expect(screen.getByRole('status').textContent).toMatch(/Downloading/);

    await act(async () => engines[1]!.settle.resolve({ docxodus: '13.0.0', dotnet: '10.0.12' }));
    expect(screen.getByRole('status').textContent).toContain('Engine ready');
  });

  it('shows an error with Retry when a ready engine fails later', async () => {
    const engines: FakeEngine[] = [];
    render(<Harness engines={engines} />);
    await act(async () => engines[0]!.settle.resolve({ docxodus: '13.0.0', dotnet: '10.0.12' }));
    act(() => engines[0]!.crash('The engine worker failed.'));
    expect(screen.getByRole('status').textContent).toContain('The engine worker failed.');

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(engines[0]!.disposed).toBe(true);
    expect(engines).toHaveLength(2);
  });
});
