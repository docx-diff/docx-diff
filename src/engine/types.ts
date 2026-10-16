// Types shared by the main thread and the engine worker.

export interface EngineVersion {
  /** Version of the `docxodus` npm package (revision ids and grouping depend on it). */
  docxodus: string;
  /** .NET runtime version reported by the engine. */
  dotnet: string;
}

/** What the engine is busy with, reported while a request runs. */
export type ProgressStage = 'loading-engine' | 'warming-up' | 'comparing' | 'listing' | 'rendering' | 'exporting';

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
  /** Compares two documents (bytes transferred, not copied), lists the revisions and renders the redline. */
  compare: { payload: { original: ArrayBuffer; edited: ArrayBuffer }; result: CompareResult };
  /** Applies a final decision to every revision of the redline (transferred) and returns the clean `.docx`. */
  export: { payload: ExportRequest; result: ArrayBuffer };
}

/** Final decision per engine revision id; every revision of the redline must have one. */
export type FinalDecisions = Record<string, 'accept' | 'reject'>;

export interface ExportRequest {
  redline: ArrayBuffer;
  revisions: RevisionListEntry[];
  decisions: FinalDecisions;
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

/** A block anchor of the engine: `<kind>:<scope>:<unid>`, e.g. `p:body:a3b3…`. */
export interface AnchorRef {
  id: string;
  /** `p`, `h`, `li`, `sec`, … */
  kind: string;
  /** `body`, `fn`, `en`, … */
  scope: string;
  /** Matches `data-anchor` in the rendered HTML. */
  unid: string;
}

/**
 * One engine revision, as listed by Docxodus `getRevisions` (the fields the app uses).
 * Ids are deterministic for the same inputs and engine version.
 */
export interface RevisionListEntry {
  id: string;
  type: 'insert' | 'delete' | 'move' | 'format' | 'structure';
  /** `content_insert`, `content_delete`, `move`, `paragraph_mark`, `properties_change`, table families, … */
  family: string;
  /** Markup carrying the revision, e.g. `kind=Content:<ns>:del:12` (formats: PRD §7.3). */
  constituentKeys: string[];
  /** The affected text; `¶` stands for a paragraph mark. */
  text: string;
  /** e.g. `/word/document.xml`, `/word/footnotes.xml`. */
  partUri: string;
  /** `body`, `fn`, `en`, … */
  scope: string;
  anchorId?: string;
  affectedAnchors: AnchorRef[];
  resolutionStatus: 'supported' | 'unsupported' | 'malformed' | 'ambiguous';
}

/** Result of the worker's `compare` request. */
export interface CompareResult {
  /** The untagged redline `.docx` (the one export works on). */
  redline: ArrayBuffer;
  revisions: RevisionListEntry[];
  /** The redline rendered to HTML, with each revision's elements carrying `data-author="rev:<revisionId>"`. */
  html: string;
  /** Either input already contained tracked changes; the engine compared their accepted view (FR-13). */
  inputsHadRevisions: boolean;
  /** Milliseconds per stage. */
  timings: { normalize: number; checkInputs: number; compare: number; list: number; tag: number; render: number };
}

/** The comparison engine as the UI sees it; implemented by `client.ts` over the worker. */
export interface ComparisonEngine {
  init(): Promise<EngineVersion>;
  version(): Promise<EngineVersion>;
  /** Compares two `.docx` files. The buffers are transferred to the worker and unusable afterwards. */
  compare(original: ArrayBuffer, edited: ArrayBuffer): Promise<CompareResult>;
  /** Produces the reviewed `.docx`. The redline buffer is transferred to the worker and unusable afterwards. */
  exportDocx(request: ExportRequest): Promise<ArrayBuffer>;
  /** Subscribes to progress events; returns the unsubscribe function. */
  onProgress(listener: (event: ProgressEvent) => void): () => void;
  /** Stops the worker; pending requests are rejected. */
  dispose(): void;
}
