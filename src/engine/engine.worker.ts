/// <reference lib="webworker" />
// Module worker that owns the Docxodus engine. Protocol: see `types.ts`.
import { engineVersion, initEngine, warmUp } from './docxodus';
import { runCompare } from './pipeline';
import type {
  ProgressEvent,
  ProgressStage,
  WorkerRequest,
  WorkerRequests,
  WorkerRequestType,
  WorkerResponse,
} from './types';

declare const self: DedicatedWorkerGlobalScope;

function progress(stage: ProgressStage, detail?: string): void {
  const event: ProgressEvent = { type: 'progress', stage, detail };
  self.postMessage(event);
}

type Handlers = {
  [K in WorkerRequestType]: (payload: WorkerRequests[K]['payload']) => Promise<WorkerRequests[K]['result']>;
};

const handlers: Handlers = {
  async init({ appBaseUrl }) {
    progress('loading-engine');
    await initEngine(appBaseUrl);
    progress('warming-up');
    warmUp();
    return engineVersion();
  },
  async version() {
    return engineVersion();
  },
  async compare({ original, edited }) {
    const result = await runCompare(new Uint8Array(original), new Uint8Array(edited), (stage) => progress(stage));
    return { ...result, redline: ownBuffer(result.redline) };
  },
};

/** An ArrayBuffer holding exactly these bytes, safe to transfer. */
function ownBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength && bytes.buffer instanceof ArrayBuffer
    ? bytes.buffer
    : bytes.slice().buffer;
}

self.addEventListener('message', async (event: MessageEvent<WorkerRequest>) => {
  const { id, type, payload } = event.data;
  let response: WorkerResponse;
  try {
    const handler = handlers[type] as (payload: unknown) => Promise<unknown>;
    if (!handler) throw new Error(`Unknown request type: ${type}`);
    response = { id, ok: true, result: await handler(payload) };
  } catch (error) {
    response = {
      id,
      ok: false,
      error: {
        message: error instanceof Error ? error.message : String(error),
        code: error instanceof Error && error.name !== 'Error' ? error.name : undefined,
      },
    };
  }
  self.postMessage(response, transferablesOf(response));
});

/** ArrayBuffers in a successful result, moved rather than copied to the main thread. */
function transferablesOf(response: WorkerResponse): Transferable[] {
  if (!response.ok || typeof response.result !== 'object' || response.result === null) return [];
  return Object.values(response.result).filter((value): value is ArrayBuffer => value instanceof ArrayBuffer);
}
