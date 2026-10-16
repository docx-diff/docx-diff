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
  /** The request the progress belongs to. */
  requestId: number;
  stage: ProgressStage;
  detail?: string;
}

export type ProgressListener = (event: ProgressEvent) => void;

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

/** Whose formatting the export uses: the Original's (formatting changes rejected) or the Edited's (accepted). */
export type FormattingChoice = 'original' | 'edited';

export interface ExportRequest {
  redline: ArrayBuffer;
  revisions: RevisionListEntry[];
  decisions: FinalDecisions;
  /** One consistent look (FR-39a) in the formatting choice's version. */
  formattingChoice?: FormattingChoice;
  /** The revisions outside the comparison range (rejected, and the look leaves them as they are). */
  outOfRange?: string[];
}

export type WorkerRequestType = keyof WorkerRequests;

export type WorkerRequest = {
  [K in WorkerRequestType]: { id: number; type: K; payload: WorkerRequests[K]['payload'] };
}[WorkerRequestType];

export interface WorkerError {
  message: string;
  /** The error class, e.g. `UnsupportedRevisionError` or `RevisionMarkupError`. */
  code?: string;
  /** The revision an export error is about. */
  revisionId?: string;
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
  /** Loads the engine; `onProgress` receives this request's progress only (likewise below). */
  init(onProgress?: ProgressListener): Promise<EngineVersion>;
  version(): Promise<EngineVersion>;
  /** Compares two `.docx` files. The buffers are transferred to the worker and unusable afterwards. */
  compare(original: ArrayBuffer, edited: ArrayBuffer, onProgress?: ProgressListener): Promise<CompareResult>;
  /** Produces the reviewed `.docx`. The redline buffer is transferred to the worker and unusable afterwards. */
  exportDocx(request: ExportRequest, onProgress?: ProgressListener): Promise<ArrayBuffer>;
  /**
   * Subscribes to the engine failing for good (e.g. the worker crashed); every later request is
   * rejected. Not called on `dispose`. Returns the unsubscribe function.
   */
  onFailure(listener: (error: Error) => void): () => void;
  /** Stops the worker; pending requests are rejected. */
  dispose(): void;
}
