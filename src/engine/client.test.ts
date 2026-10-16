import { describe, expect, it } from 'vitest';
import { EngineClient, EngineError, type WorkerLike } from './client';
import type { ProgressEvent, WorkerMessage, WorkerRequest } from './types';

/** A fake worker that records requests and lets the test answer them. */
class FakeWorker implements WorkerLike {
  readonly sent: WorkerRequest[] = [];
  readonly transferred: Transferable[][] = [];
  terminated = false;
  private messageListener: ((event: MessageEvent<WorkerMessage>) => void) | null = null;
  private errorListener: ((event: ErrorEvent) => void) | null = null;

  postMessage(message: unknown, transfer: Transferable[]): void {
    this.sent.push(message as WorkerRequest);
    this.transferred.push(transfer);
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

  it('sends compare with both documents as transferables', async () => {
    const worker = new FakeWorker();
    const client = new EngineClient(worker, 'http://localhost/');
    const original = new ArrayBuffer(4);
    const edited = new ArrayBuffer(8);
    const result = client.compare(original, edited);
    expect(worker.sent).toEqual([{ id: 1, type: 'compare', payload: { original, edited } }]);
    expect(worker.transferred[0]).toEqual([original, edited]);
    const compareResult = { redline: new ArrayBuffer(2), revisions: [], html: '<p/>', inputsHadRevisions: false };
    worker.reply({ id: 1, ok: true, result: compareResult });
    await expect(result).resolves.toBe(compareResult);
  });

  it('sends export with the redline as a transferable', async () => {
    const worker = new FakeWorker();
    const client = new EngineClient(worker, 'http://localhost/');
    const request = { redline: new ArrayBuffer(4), revisions: [], decisions: {} };
    const result = client.exportDocx(request);
    expect(worker.sent).toEqual([{ id: 1, type: 'export', payload: request }]);
    expect(worker.transferred[0]).toEqual([request.redline]);
    const exported = new ArrayBuffer(3);
    worker.reply({ id: 1, ok: true, result: exported });
    await expect(result).resolves.toBe(exported);
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

  it('passes progress events to the listener of their request only, while it is pending', async () => {
    const worker = new FakeWorker();
    const client = new EngineClient(worker, 'http://localhost/');
    const first: ProgressEvent[] = [];
    const second: ProgressEvent[] = [];
    const firstResult = client.compare(new ArrayBuffer(1), new ArrayBuffer(1), (event) => first.push(event));
    void client.compare(new ArrayBuffer(1), new ArrayBuffer(1), (event) => second.push(event));
    worker.reply({ type: 'progress', requestId: 1, stage: 'comparing' });
    worker.reply({ type: 'progress', requestId: 2, stage: 'listing' });
    worker.reply({ id: 1, ok: true, result: {} });
    await firstResult;
    worker.reply({ type: 'progress', requestId: 1, stage: 'rendering' });
    expect(first).toEqual([{ type: 'progress', requestId: 1, stage: 'comparing' }]);
    expect(second).toEqual([{ type: 'progress', requestId: 2, stage: 'listing' }]);
  });

  it('rejects pending and later requests when the worker fails, and tells the failure listeners once', async () => {
    const worker = new FakeWorker();
    const client = new EngineClient(worker, 'http://localhost/');
    const failures: Error[] = [];
    client.onFailure((error) => failures.push(error));
    const pending = client.init();
    worker.crash('Script error');
    worker.crash('Again');
    await expect(pending).rejects.toMatchObject({ message: 'Script error', code: 'worker_error' });
    await expect(client.version()).rejects.toMatchObject({ code: 'worker_error' });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ message: 'Script error' });
  });

  it('terminates the worker on dispose, without reporting a failure', async () => {
    const worker = new FakeWorker();
    const client = new EngineClient(worker, 'http://localhost/');
    const failures: Error[] = [];
    client.onFailure((error) => failures.push(error));
    const pending = client.init();
    client.dispose();
    expect(worker.terminated).toBe(true);
    await expect(pending).rejects.toMatchObject({ code: 'disposed' });
    expect(failures).toEqual([]);
  });
});
