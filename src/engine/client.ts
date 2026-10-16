// Main-thread side of the engine worker: typed, promise-based requests over postMessage.
import type {
  CompareResult,
  ComparisonEngine,
  EngineVersion,
  ProgressEvent,
  WorkerMessage,
  WorkerRequest,
  WorkerRequests,
  WorkerRequestType,
} from './types';

/** An error reported by the engine worker, or the worker failing to start. */
export class EngineError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'EngineError';
  }
}

/** The subset of `Worker` the client uses (lets tests pass a fake). */
export interface WorkerLike {
  postMessage(message: unknown, transfer: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerMessage>) => void): void;
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
  terminate(): void;
}

export function createEngineWorker(): WorkerLike {
  return new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module', name: 'docxodus-engine' });
}

/** Absolute URL of the app's base path (the folder that holds `wasm/`). */
export function appBaseUrl(): string {
  return new URL(import.meta.env.BASE_URL, self.location.href).href;
}

interface Pending {
  resolve(result: unknown): void;
  reject(error: Error): void;
}

export class EngineClient implements ComparisonEngine {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly progressListeners = new Set<(event: ProgressEvent) => void>();
  private failure: EngineError | null = null;

  constructor(
    private readonly worker: WorkerLike = createEngineWorker(),
    private readonly baseUrl: string = appBaseUrl(),
  ) {
    worker.addEventListener('message', (event) => this.handleMessage(event.data));
    worker.addEventListener('error', (event) => {
      this.fail(new EngineError(event.message || 'The engine worker failed to start.', 'worker_error'));
    });
  }

  init(): Promise<EngineVersion> {
    return this.request('init', { appBaseUrl: this.baseUrl });
  }

  version(): Promise<EngineVersion> {
    return this.request('version', undefined);
  }

  compare(original: ArrayBuffer, edited: ArrayBuffer): Promise<CompareResult> {
    return this.request('compare', { original, edited }, [original, edited]);
  }

  onProgress(listener: (event: ProgressEvent) => void): () => void {
    this.progressListeners.add(listener);
    return () => this.progressListeners.delete(listener);
  }

  dispose(): void {
    this.worker.terminate();
    this.fail(new EngineError('The engine was stopped.', 'disposed'));
  }

  private request<K extends WorkerRequestType>(
    type: K,
    payload: WorkerRequests[K]['payload'],
    transfer: Transferable[] = [],
  ): Promise<WorkerRequests[K]['result']> {
    if (this.failure) return Promise.reject(this.failure);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (result: unknown) => void, reject });
      this.worker.postMessage({ id, type, payload } as WorkerRequest, transfer);
    });
  }

  private handleMessage(message: WorkerMessage): void {
    if ('type' in message) {
      for (const listener of this.progressListeners) listener(message);
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.ok) pending.resolve(message.result);
    else pending.reject(new EngineError(message.error.message, message.error.code));
  }

  /** Rejects every pending request and all later ones. */
  private fail(error: EngineError): void {
    this.failure ??= error;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}
