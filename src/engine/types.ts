// Types shared by the main thread and the engine worker.

export interface EngineVersion {
  /** Version of the `docxodus` npm package (revision ids and grouping depend on it). */
  docxodus: string;
  /** .NET runtime version reported by the engine. */
  dotnet: string;
}

/** What the engine is busy with, reported while a request runs. */
export type ProgressStage = 'loading-engine' | 'warming-up';

export interface ProgressEvent {
  type: 'progress';
  stage: ProgressStage;
  detail?: string;
}

/** Payload and result type of every worker request, by request type. */
export interface WorkerRequests {
  /** Loads the engine from `<appBaseUrl>wasm/_framework/` and warms it up. */
  init: { payload: { appBaseUrl: string }; result: EngineVersion };
  version: { payload: undefined; result: EngineVersion };
}

export type WorkerRequestType = keyof WorkerRequests;

export type WorkerRequest = {
  [K in WorkerRequestType]: { id: number; type: K; payload: WorkerRequests[K]['payload'] };
}[WorkerRequestType];

export interface WorkerError {
  message: string;
  code?: string;
}

export type WorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: WorkerError };

export type WorkerMessage = WorkerResponse | ProgressEvent;

/** The comparison engine as the UI sees it; implemented by `client.ts` over the worker. */
export interface ComparisonEngine {
  init(): Promise<EngineVersion>;
  version(): Promise<EngineVersion>;
  /** Subscribes to progress events; returns the unsubscribe function. */
  onProgress(listener: (event: ProgressEvent) => void): () => void;
  /** Stops the worker; pending requests are rejected. */
  dispose(): void;
}
