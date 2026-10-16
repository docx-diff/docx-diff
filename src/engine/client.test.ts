import { describe, expect, it } from 'vitest';
import { EngineClient, EngineError, type WorkerLike } from './client';
import type { ProgressEvent, WorkerMessage, WorkerRequest } from './types';

/** A fake worker that records requests and lets the test answer them. */
class FakeWorker implements WorkerLike {
  readonly sent: WorkerRequest[] = [];
  terminated = false;
  private messageListener: ((event: MessageEvent<WorkerMessage>) => void) | null = null;
  private errorListener: ((event: ErrorEvent) => void) | null = null;

  postMessage(message: unknown): void {
    this.sent.push(message as WorkerRequest);
  }

  addEventListener(type: 'message' | 'error', listener: (event: never) => void): void {
    if (type === 'message') this.messageListener = listener as (event: MessageEvent<WorkerMessage>) => void;
    else this.errorListener = listener as (event: ErrorEvent) => void;
  }

  terminate(): void {
    this.terminated = true;
  }

  reply(message: WorkerMessage): void {
    this.messageListener?.({ data: message } as MessageEvent<WorkerMessage>);
  }

  crash(message: string): void {
    this.errorListener?.({ message } as ErrorEvent);
  }
}

const VERSION = { docxodus: '13.0.0', dotnet: '10.0.12' };

describe('EngineClient', () => {
  it('sends init with the app base URL and resolves with the result', async () => {
    const worker = new FakeWorker();
    const client = new EngineClient(worker, 'https://example.org/docx-diff/');
    const result = client.init();
    expect(worker.sent).toEqual([{ id: 1, type: 'init', payload: { appBaseUrl: 'https://example.org/docx-diff/' } }]);
    worker.reply({ id: 1, ok: true, result: VERSION });
    await expect(result).resolves.toEqual(VERSION);
  });

  it('matches responses to requests by id', async () => {
    const worker = new FakeWorker();
    const client = new EngineClient(worker, 'http://localhost/');
    const first = client.version();
    const second = client.version();
    worker.reply({ id: 2, ok: true, result: { ...VERSION, dotnet: 'second' } });
    worker.reply({ id: 1, ok: true, result: { ...VERSION, dotnet: 'first' } });
    await expect(first).resolves.toMatchObject({ dotnet: 'first' });
    await expect(second).resolves.toMatchObject({ dotnet: 'second' });
  });

  it('maps error responses to EngineError with message and code', async () => {
    const worker = new FakeWorker();
    const client = new EngineClient(worker, 'http://localhost/');
    const result = client.init();
    worker.reply({ id: 1, ok: false, error: { message: 'Failed to load WASM', code: 'load_failed' } });
    await expect(result).rejects.toThrow(EngineError);
    await expect(result).rejects.toMatchObject({ message: 'Failed to load WASM', code: 'load_failed' });
  });

  it('passes progress events to listeners until they unsubscribe', () => {
    const worker = new FakeWorker();
    const client = new EngineClient(worker, 'http://localhost/');
    const events: ProgressEvent[] = [];
    const unsubscribe = client.onProgress((event) => events.push(event));
    worker.reply({ type: 'progress', stage: 'loading-engine' });
    unsubscribe();
    worker.reply({ type: 'progress', stage: 'warming-up' });
    expect(events).toEqual([{ type: 'progress', stage: 'loading-engine' }]);
  });

  it('rejects pending and later requests when the worker fails', async () => {
    const worker = new FakeWorker();
    const client = new EngineClient(worker, 'http://localhost/');
    const pending = client.init();
    worker.crash('Script error');
    await expect(pending).rejects.toMatchObject({ message: 'Script error', code: 'worker_error' });
    await expect(client.version()).rejects.toMatchObject({ code: 'worker_error' });
  });

  it('terminates the worker on dispose', async () => {
    const worker = new FakeWorker();
    const client = new EngineClient(worker, 'http://localhost/');
    const pending = client.init();
    client.dispose();
    expect(worker.terminated).toBe(true);
    await expect(pending).rejects.toMatchObject({ code: 'disposed' });
  });
});
