/// <reference lib="webworker" />
// Module worker that owns the Docxodus engine. Protocol: see `types.ts`.
import { engineVersion, initEngine, warmUp } from './docxodus';
import { exportDocx } from './exportDocx';
import { runCompare } from './pipeline';
import { RevisionMarkupError, UnsupportedRevisionError } from './rejectRewrite';
import type {
  ProgressEvent,
  ProgressStage,
  WorkerRequest,
  WorkerRequests,
  WorkerRequestType,
  WorkerResponse,
} from './types';

declare const self: DedicatedWorkerGlobalScope;

/** Reports progress of one request. */
type Report = (stage: ProgressStage, detail?: string) => void;

function reporter(requestId: number): Report {
  return (stage, detail) => {
    const event: ProgressEvent = { type: 'progress', requestId, stage, detail };
    self.postMessage(event);
  };
}

type Handlers = {
  [K in WorkerRequestType]: (payload: WorkerRequests[K]['payload'], progress: Report) => Promise<WorkerRequests[K]['result']>;
};

const handlers: Handlers = {
  async init({ appBaseUrl }, progress) {
    progress('loading-engine');
    await initEngine(appBaseUrl);
    progress('warming-up');
    warmUp();
    return engineVersion();
  },
  async version() {
    return engineVersion();
  },
  async compare({ original, edited }, progress) {
    const result = await runCompare(new Uint8Array(original), new Uint8Array(edited), (stage) => progress(stage));
    return { ...result, redline: ownBuffer(result.redline) };
  },
  async export({ redline, revisions, decisions, look }, progress) {
    progress('exporting');
    const lookOptions = look && { formattingChoice: look.formattingChoice, outOfRange: new Set(look.outOfRange) };
    return ownBuffer(await exportDocx(new Uint8Array(redline), revisions, new Map(Object.entries(decisions)), lookOptions));
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
    const handler = handlers[type] as (payload: unknown, progress: Report) => Promise<unknown>;
    if (!handler) throw new Error(`Unknown request type: ${type}`);
    response = { id, ok: true, result: await handler(payload, reporter(id)) };
  } catch (error) {
    response = {
      id,
      ok: false,
      error: {
        message: error instanceof Error ? error.message : String(error),
        code: error instanceof Error && error.name !== 'Error' ? error.name : undefined,
        revisionId: revisionIdOf(error),
      },
    };
  }
  self.postMessage(response, transferablesOf(response));
});

function revisionIdOf(error: unknown): string | undefined {
  return error instanceof UnsupportedRevisionError || error instanceof RevisionMarkupError ? error.revisionId : undefined;
}

/** ArrayBuffers in a successful result, moved rather than copied to the main thread. */
function transferablesOf(response: WorkerResponse): Transferable[] {
  if (!response.ok || typeof response.result !== 'object' || response.result === null) return [];
  if (response.result instanceof ArrayBuffer) return [response.result];
  return Object.values(response.result).filter((value): value is ArrayBuffer => value instanceof ArrayBuffer);
}
