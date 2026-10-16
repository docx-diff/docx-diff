import { useCallback, useMemo, useRef, useState } from 'react';
import type { ProgressStage } from './engine/types';
import { ignoredItems } from './model/equivalence';
import { CompareSettingsDialog } from './ui/CompareSettingsDialog';
import { DocumentPanel } from './ui/DocumentPanel';
import { EngineStatus } from './ui/EngineStatus';
import { FileDropZones, type DocumentRole } from './ui/FileDropZones';
import { LoadingModal } from './ui/LoadingModal';
import { Progress } from './ui/Progress';
import { Toolbar } from './ui/Toolbar';
import { reviewedFileName, saveDocx } from './ui/download';
import { useComparison, type Comparison } from './ui/useComparison';
import { useCompareSettings } from './ui/useCompareSettings';
import { useEngine } from './ui/useEngine';
import { useScrollSync } from './ui/scrollSync';

type ExportState = { status: 'idle' } | { status: 'running'; startedAt: number } | { status: 'error'; message: string };

export function App() {
  const { state: engineState, retry } = useEngine();
  const engine = engineState.status === 'ready' ? engineState.engine : null;

  const [files, setFiles] = useState<{ original: File | null; edited: File | null }>({ original: null, edited: null });
  const comparisonState = useComparison(engine, files.original, files.edited);
  const comparison = comparisonState.status === 'done' ? comparisonState.comparison : null;

  const [settings, setSettings] = useCompareSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const ignored = useMemo(
    () => (comparison ? ignoredItems(comparison.analysis.items, comparison.itemTexts, settings) : new Set<string>()),
    [comparison, settings],
  );

  const [scrollLock, setScrollLock] = useState(true);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  useScrollSync(leftRef, rightRef, scrollLock, comparison);

  const [exportState, setExportState] = useState<ExportState>({ status: 'idle' });

  const setFile = useCallback((role: DocumentRole, file: File) => setFiles((current) => ({ ...current, [role]: file })), []);
  const swap = useCallback(() => setFiles(({ original, edited }) => ({ original: edited, edited: original })), []);

  const download = async (current: Comparison) => {
    if (!engine) return;
    setExportState({ status: 'running', startedAt: performance.now() });
    try {
      // Until the review workflow exists, every change is accepted (ignored ones always are).
      const decisions = Object.fromEntries(current.result.revisions.map((revision) => [revision.id, 'accept' as const]));
      const bytes = await engine.exportDocx({
        redline: current.result.redline.slice(0),
        revisions: current.result.revisions,
        decisions,
      });
      saveDocx(bytes, reviewedFileName(current.editedName));
      setExportState({ status: 'idle' });
    } catch (error) {
      setExportState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  };

  return (
    <main className="app">
      <header className="app-header">
        <h1>docx-diff</h1>
        {comparison && (
          <Toolbar
            original={files.original}
            edited={files.edited}
            onFile={setFile}
            onSwap={swap}
            scrollLock={scrollLock}
            onScrollLockChange={setScrollLock}
            onDownload={() => void download(comparison)}
            downloading={exportState.status === 'running'}
            summary={summarize(comparison, ignored)}
          />
        )}
        <button type="button" className="button" onClick={() => setSettingsOpen(true)}>
          ⚙ Compare settings
        </button>
        <EngineStatus state={engineState} onRetry={retry} />
      </header>

      <Notices
        comparisonRunning={comparisonState.status === 'running' ? comparisonState : null}
        comparisonError={comparisonState.status === 'error' ? comparisonState.message : null}
        exportState={exportState}
        onDismissExportError={() => setExportState({ status: 'idle' })}
        inputsHadRevisions={comparison?.result.inputsHadRevisions ?? false}
      />

      {comparison ? (
        <div className="panels">
          <DocumentPanel ref={leftRef} side="left" title={comparison.originalName} document={comparison.document} ignored={ignored} settings={settings} />
          <DocumentPanel ref={rightRef} side="right" title={comparison.editedName} document={comparison.document} ignored={ignored} settings={settings} />
        </div>
      ) : (
        <FileDropZones
          original={files.original}
          edited={files.edited}
          onFile={setFile}
          onSwap={swap}
          disabled={comparisonState.status === 'running'}
        />
      )}
      {engineState.status === 'loading' && (
        <LoadingModal detail={<Progress startedAt={engineState.startedAt} stage={engineState.stage ?? 'loading-engine'} />} />
      )}
      {settingsOpen && (
        <CompareSettingsDialog settings={settings} onChange={setSettings} onClose={() => setSettingsOpen(false)} />
      )}
    </main>
  );
}

/** Counts for the toolbar: text changes, formatting changes, ignored changes. */
function summarize(comparison: Comparison, ignored: ReadonlySet<string>): { text: number; formatting: number; ignored: number } {
  let text = 0;
  let formatting = 0;
  for (const item of comparison.analysis.items) {
    if (ignored.has(item.id)) continue;
    if (item.kind === 'formatting') formatting++;
    else text++;
  }
  return { text, formatting, ignored: ignored.size };
}

function Notices(props: {
  comparisonRunning: { startedAt: number; stage: ProgressStage | null } | null;
  comparisonError: string | null;
  exportState: ExportState;
  onDismissExportError: () => void;
  inputsHadRevisions: boolean;
}) {
  const { comparisonRunning, comparisonError, exportState } = props;
  return (
    <div className="notices" aria-live="polite">
      {comparisonRunning && (
        <p className="notice notice--progress" data-testid="compare-progress">
          <Progress startedAt={comparisonRunning.startedAt} stage={comparisonRunning.stage ?? 'comparing'} />
        </p>
      )}
      {comparisonError && (
        <p className="notice notice--error" role="alert">
          The documents could not be compared: {comparisonError}
        </p>
      )}
      {exportState.status === 'running' && (
        <p className="notice notice--progress">
          <Progress startedAt={exportState.startedAt} stage="exporting" />
        </p>
      )}
      {exportState.status === 'error' && (
        <p className="notice notice--error" role="alert">
          The download could not be prepared: {exportState.message}{' '}
          <button type="button" className="button" onClick={props.onDismissExportError}>
            Dismiss
          </button>
        </p>
      )}
      {props.inputsHadRevisions && (
        <p className="notice notice--info">
          At least one of the documents already contained tracked changes. They were compared as if those changes had
          been accepted.
        </p>
      )}
    </div>
  );
}
