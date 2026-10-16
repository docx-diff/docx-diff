import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { CompareResult, ComparisonEngine, EngineVersion, ProgressEvent } from '../engine/types';
import { EngineStatus } from './EngineStatus';
import { useEngine } from './useEngine';

/** A fake engine whose `init` the test settles by hand. */
class FakeEngine implements ComparisonEngine {
  disposed = false;
  settle!: { resolve(version: EngineVersion): void; reject(error: Error): void };
  private listener: ((event: ProgressEvent) => void) | null = null;

  init(): Promise<EngineVersion> {
    return new Promise((resolve, reject) => {
      this.settle = { resolve, reject };
    });
  }
  version(): Promise<EngineVersion> {
    return Promise.reject(new Error('not used'));
  }
  compare(): Promise<CompareResult> {
    return Promise.reject(new Error('not used'));
  }
  onProgress(listener: (event: ProgressEvent) => void): () => void {
    this.listener = listener;
    return () => {
      this.listener = null;
    };
  }
  dispose(): void {
    this.disposed = true;
  }
  progress(event: ProgressEvent): void {
    this.listener?.(event);
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

    act(() => engines[0]!.progress({ type: 'progress', stage: 'warming-up' }));
    expect(screen.getByRole('status').textContent).toMatch(/Starting the comparison engine/);

    await act(async () => engines[0]!.settle.resolve({ docxodus: '13.0.0', dotnet: '10.0.12' }));
    expect(screen.getByRole('status').textContent).toBe('Engine ready · Docxodus 13.0.0');
  });

  it('shows the error with Retry, which starts a new engine', async () => {
    const engines: FakeEngine[] = [];
    render(<Harness engines={engines} />);
    await act(async () => engines[0]!.settle.reject(new Error('Failed to load WASM')));
    expect(screen.getByRole('status').textContent).toContain('Failed to load WASM');

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(engines[0]!.disposed).toBe(true);
    expect(engines).toHaveLength(2);
    expect(screen.getByRole('status').textContent).toMatch(/Downloading/);

    await act(async () => engines[1]!.settle.resolve({ docxodus: '13.0.0', dotnet: '10.0.12' }));
    expect(screen.getByRole('status').textContent).toContain('Engine ready');
  });
});
