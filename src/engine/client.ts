// Main-thread side of the engine worker: typed, promise-based requests over postMessage.
import type {
  CompareResult,
  ComparisonEngine,
  EngineVersion,
  ExportRequest,
  ProgressListener,
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
  onProgress?: ProgressListener;
}

export class EngineClient implements ComparisonEngine {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly failureListeners = new Set<(error: Error) => void>();
  private failure: EngineError | null = null;

  constructor(
    private readonly worker: WorkerLike = createEngineWorker(),
    private readonly baseUrl: string = appBaseUrl(),
  ) {
    worker.addEventListener('message', (event) => this.handleMessage(event.data));
    worker.addEventListener('error', (event) => {
      this.fail(new EngineError(event.message || 'The engine worker failed.', 'worker_error'));
    });
  }

  init(onProgress?: ProgressListener): Promise<EngineVersion> {
    return this.request('init', { appBaseUrl: this.baseUrl }, [], onProgress);
  }

  version(): Promise<EngineVersion> {
    return this.request('version', undefined);
  }

  compare(original: ArrayBuffer, edited: ArrayBuffer, onProgress?: ProgressListener): Promise<CompareResult> {
    return this.request('compare', { original, edited }, [original, edited], onProgress);
  }

  exportDocx(request: ExportRequest, onProgress?: ProgressListener): Promise<ArrayBuffer> {
    return this.request('export', request, [request.redline], onProgress);
  }

  onFailure(listener: (error: Error) => void): () => void {
    this.failureListeners.add(listener);
    return () => this.failureListeners.delete(listener);
  }

  dispose(): void {
    this.worker.terminate();
    this.failureListeners.clear();
    this.fail(new EngineError('The engine was stopped.', 'disposed'));
  }

  private request<K extends WorkerRequestType>(
    type: K,
    payload: WorkerRequests[K]['payload'],
    transfer: Transferable[] = [],
    onProgress?: ProgressListener,
  ): Promise<WorkerRequests[K]['result']> {
    if (this.failure) return Promise.reject(this.failure);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (result: unknown) => void, reject, onProgress });
      this.worker.postMessage({ id, type, payload } as WorkerRequest, transfer);
    });
  }

  private handleMessage(message: WorkerMessage): void {
    if ('type' in message) {
      // Progress of a request that has settled or was never ours is dropped.
      this.pending.get(message.requestId)?.onProgress?.(message);
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.ok) pending.resolve(message.result);
    else pending.reject(new EngineError(message.error.message, message.error.code));
  }

  /** Rejects every pending request and all later ones, and tells the failure listeners (once). */
  private fail(error: EngineError): void {
    if (this.failure) return;
    this.failure = error;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    for (const listener of this.failureListeners) listener(error);
  }
}
