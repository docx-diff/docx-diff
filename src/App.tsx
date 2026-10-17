import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { ProgressStage } from './engine/types';
import {
  INITIAL_DECISIONS,
  decisionTotals,
  decisionsReducer,
  finalRevisionDecisions,
  formattingItems,
  reviewableItems,
  type Decision,
  type DecisionState,
  type UndecidedChoice,
} from './model/decisions';
import { ignoredItems } from './model/equivalence';
import {
  blockPositions,
  classify,
  initialRange,
  outOfRangeBlocks,
  restoredRange,
  spanningItems,
  type RangeClass,
  type RangeState,
} from './model/range';
import { buildReviewList, navigationOrder, nextUndecided, step } from './model/reviewList';
import { savedFilesMatch, type ReviewState, type SavedReview } from './storage/reviewStore';
import { ChangesList } from './ui/ChangesList';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { CompareSettingsDialog } from './ui/CompareSettingsDialog';
import { DocumentPanel } from './ui/DocumentPanel';
import { EngineStatus } from './ui/EngineStatus';
import { ExportDialog, exportFailure, type ExportStatus } from './ui/ExportDialog';
import { FileDropZones, type DocumentRole } from './ui/FileDropZones';
import { LoadingModal } from './ui/LoadingModal';
import { Progress } from './ui/Progress';
import { RangeControl } from './ui/RangeControl';
import { ResumePrompt } from './ui/ResumePrompt';
import { Toolbar } from './ui/Toolbar';
import { DOCX_TYPE, reviewedFileName, saveDocx } from './ui/download';
import { useComparison, type Comparison } from './ui/useComparison';
import { useCompareSettings } from './ui/useCompareSettings';
import { useEngine } from './ui/useEngine';
import { useAutoSave, useReviewStorage } from './ui/useReviewStorage';
import { revealItem } from './ui/reveal';
import { useScrollSync } from './ui/scrollSync';
import { useKeyboardShortcuts, type ShortcutAction } from './ui/useKeyboardShortcuts';
import { registerServiceWorker } from './serviceWorker';

export function App() {
  const { state: engineState, retry } = useEngine();
  const engine = engineState.status === 'ready' ? engineState.engine : null;
  const engineVersion = engineState.status === 'ready' ? engineState.version.docxodus : null;
  useEffect(() => {
    if (engine) registerServiceWorker();
  }, [engine]);

  const [files, setFiles] = useState<{ original: File | null; edited: File | null }>({ original: null, edited: null });
  const comparisonState = useComparison(engine, files.original, files.edited);
  const comparison = comparisonState.status === 'done' ? comparisonState.comparison : null;

  const { storage, markUnavailable } = useReviewStorage();
  const store = storage.status === 'ready' ? storage.store : null;
  const [storageNoticeDismissed, setStorageNoticeDismissed] = useState(false);
  // The review saved by an earlier visit is offered once, before any file is chosen (FR-47).
  const [promptDone, setPromptDone] = useState(false);
  const offeredReview = storage.status === 'ready' && !promptDone && !files.original && !files.edited ? storage.saved : null;
  const [checkingSaved, setCheckingSaved] = useState(false);
  /** Files being compared again to resume a review; `review` is null when its decisions must not be applied. */
  const [resuming, setResuming] = useState<{ original: File; edited: File; review: SavedReview | null } | null>(null);
  const [resumeNotice, setResumeNotice] = useState<string | null>(null);

  const [settings, setSettings] = useCompareSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const ignored = useMemo(
    () => (comparison ? ignoredItems(comparison.analysis.items, comparison.itemTexts, settings) : new Set<string>()),
    [comparison, settings],
  );

  const [scrollLock, setScrollLock] = useState(true);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const scrollController = useScrollSync(leftRef, rightRef, scrollLock, comparison);

  const [review, dispatch] = useReducer(decisionsReducer, INITIAL_DECISIONS);
  const [currentItemId, setCurrentItemId] = useState<string | null>(null);
  const [formattingExpanded, setFormattingExpanded] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [rangeState, setRangeState] = useState<RangeState>(initialRange(null));
  const [picking, setPicking] = useState(false);
  // A new comparison starts a new review. Reset while rendering, so that the panels never show the
  // previous review's decisions on the new document.
  const [reviewedComparison, setReviewedComparison] = useState(comparison);
  /** Changes with each comparison: resets the local state of the controls that belong to one review. */
  const [reviewKey, setReviewKey] = useState(0);
  if (comparison !== reviewedComparison) {
    setReviewedComparison(comparison);
    setReviewKey((key) => key + 1);
    const resumed = comparison && resuming?.original === comparison.original && resuming.edited === comparison.edited;
    if (resumed) setResuming(null);
    const saved = resumed ? resuming.review : null;
    const suggested = comparison?.analysis.suggestedEndPoint ?? null;
    if (comparison && saved) {
      // Item ids are stable for the same files and engine version; drop any that are not there anyway.
      const known = new Set(comparison.analysis.items.map((item) => item.id));
      const decisions = Object.fromEntries(Object.entries(saved.decisions).filter(([id]) => known.has(id)));
      dispatch({ type: 'restore', state: { decisions, formattingChoice: saved.formattingChoice } });
      setFormattingExpanded(saved.formattingGroupExpanded);
      setRangeState(restoredRange(saved.range, comparison.analysis.index.bodyParagraphs.length, suggested));
    } else {
      dispatch({ type: 'clear' });
      setFormattingExpanded(false);
      setRangeState(initialRange(suggested));
    }
    setCurrentItemId(null);
    setPicking(false);
  }

  const reviewState = useMemo<ReviewState>(
    () => ({
      range: rangeState,
      decisions: review.decisions,
      formattingChoice: review.formattingChoice,
      compareSettings: settings,
      formattingGroupExpanded: formattingExpanded,
    }),
    [rangeState, review, settings, formattingExpanded],
  );
  const discardSavedReview = useAutoSave(store, comparison, engineVersion, reviewState, markUnavailable);

  /** Compares the saved files again; their decisions and range are applied only if the files and engine version match (FR-49). */
  const resume = async (saved: SavedReview) => {
    if (engineVersion === null) return;
    setCheckingSaved(true);
    // Hashing fails without `crypto.subtle` (outside a secure context): then nothing is restored.
    const match = await savedFilesMatch(saved, engineVersion).catch(() => 'unchecked' as const);
    const original = new File([saved.original.bytes], saved.original.name, { type: DOCX_TYPE });
    const edited = new File([saved.edited.bytes], saved.edited.name, { type: DOCX_TYPE });
    setSettings(saved.compareSettings);
    setResuming({ original, edited, review: match === 'match' ? saved : null });
    setResumeNotice(
      match === 'match'
        ? null
        : match === 'engine'
          ? `The saved decisions could not be restored: they were made with version ${saved.engineVersion} of the comparison engine, and this is version ${engineVersion}. The documents were compared again; please review them anew.`
          : match === 'files'
            ? 'The saved decisions could not be restored: the saved documents are damaged. They were compared again; please review them anew.'
            : 'The saved decisions could not be restored: this page cannot check the saved documents (it is not served over HTTPS). They were compared again; please review them anew.',
    );
    setFiles({ original, edited });
    setCheckingSaved(false);
    setPromptDone(true);
  };
  const discardSaved = () => {
    discardSavedReview();
    setPromptDone(true);
  };
  const [closeOpen, setCloseOpen] = useState(false);
  const closeReview = () => {
    discardSavedReview();
    setFiles({ original: null, edited: null });
    setResuming(null);
    setResumeNotice(null);
    setCloseOpen(false);
  };
  const startNew = useCallback(() => setPromptDone(true), []);

  const items = comparison?.analysis.items;
  // The comparison range only reclassifies the changes (FR-19); their decisions are kept.
  const positions = useMemo(
    () => (comparison ? blockPositions(comparison.analysis.index, comparison.analysis.suggestedEndPoint) : new Map<string, number>()),
    [comparison],
  );
  const range = useMemo(
    () =>
      comparison ? classify(comparison.analysis.items, comparison.analysis.index, rangeState.endPoint, positions) : new Map<string, RangeClass>(),
    [comparison, rangeState, positions],
  );
  const spanning = useMemo(
    () => (comparison ? spanningItems(comparison.analysis.items, comparison.analysis.index, rangeState.endPoint, range, positions) : []),
    [comparison, rangeState, range, positions],
  );
  const outOfRange = useMemo(() => new Set((items ?? []).filter((item) => range.get(item.id) === 'outOfRange').map((item) => item.id)), [items, range]);
  const outsideBlocks = useMemo(
    () => (comparison ? outOfRangeBlocks(comparison.analysis.index, rangeState.endPoint, positions) : new Set<string>()),
    [comparison, rangeState, positions],
  );
  const paragraphIndex = useMemo(() => new Map((comparison?.analysis.index.bodyParagraphs ?? []).map((unid, i) => [unid, i])), [comparison]);
  /**
   * A click on a paragraph of the Original while picking: it becomes the last paragraph in range.
   * The last paragraph of all leaves nothing outside: the full documents are compared.
   */
  const pickParagraph = useCallback(
    (unids: string[]) => {
      const at = unids.map((unid) => paragraphIndex.get(unid)).find((i) => i !== undefined);
      if (at === undefined) return;
      setRangeState(at + 1 >= paragraphIndex.size ? { mode: 'off', endPoint: null } : { mode: 'manual', endPoint: at + 1 });
      setPicking(false);
    },
    [paragraphIndex],
  );
  useEffect(() => {
    if (!picking) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPicking(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [picking]);
  const reviewable = useMemo(() => reviewableItems(items ?? [], range, ignored), [items, range, ignored]);
  const formatting = useMemo(() => formattingItems(items ?? [], range), [items, range]);
  const entries = useMemo(() => buildReviewList(reviewable, formatting, formattingExpanded), [reviewable, formatting, formattingExpanded]);
  const order = useMemo(() => navigationOrder(entries), [entries]);
  const itemById = useMemo(() => new Map((items ?? []).map((item) => [item.id, item])), [items]);
  const totals = useMemo(
    () => ({
      text: decisionTotals(reviewable, review.decisions),
      formatting: formatting.length,
      ignored: [...ignored].filter((id) => range.get(id) !== 'outOfRange').length,
    }),
    [reviewable, formatting, ignored, range, review.decisions],
  );

  /** Makes an item the current one; `reveal` scrolls both panels to it (not for a click in a panel). */
  const select = useCallback(
    (itemId: string | null, reveal: boolean) => {
      setCurrentItemId(itemId);
      const item = itemId === null ? undefined : itemById.get(itemId);
      if (reveal && item && leftRef.current && rightRef.current) {
        revealItem(leftRef.current, rightRef.current, item.id, item.anchors, scrollController);
      }
    },
    [itemById, scrollController],
  );
  const selectFromList = useCallback((itemId: string) => select(itemId, true), [select]);

  const decide = useCallback((itemId: string, decision: Decision | null) => {
    dispatch(decision === null ? { type: 'reset', itemId } : { type: 'set', itemId, decision });
  }, []);

  const onChangeClick = useCallback(
    (itemIds: string[]) => {
      const selectable = itemIds.find((id) => order.some((item) => item.id === id));
      if (selectable !== undefined) select(selectable, false);
    },
    [order, select],
  );

  const onShortcut = (action: ShortcutAction) => {
    if (action === 'help') {
      setHelpOpen((open) => !open);
      return;
    }
    const current = currentItemId === null ? undefined : itemById.get(currentItemId);
    if (action === 'next' || action === 'previous') {
      const target = step(order, current ?? null, action === 'next' ? 1 : -1);
      if (target !== null) select(target, true);
      return;
    }
    if (!current || current.kind === 'formatting' || !order.includes(current)) return;
    if (action === 'reset') {
      decide(current.id, null);
      return;
    }
    const decision: Decision = action === 'accept' ? 'accepted' : 'rejected';
    decide(current.id, decision);
    const next = nextUndecided(order, current.id, { ...review.decisions, [current.id]: decision });
    if (next !== null) select(next, true);
  };
  useKeyboardShortcuts(onShortcut, comparison !== null && !settingsOpen);

  const [exportOpen, setExportOpen] = useState(false);
  const [exportState, setExportState] = useState<ExportStatus>({ status: 'idle' });
  const openExport = useCallback(() => {
    setExportState({ status: 'idle' });
    setExportOpen(true);
  }, []);
  const closeExport = useCallback(() => setExportOpen(false), []);
  const exportCounts = useMemo(() => {
    const decided = [...ignored].filter((id) => range.get(id) !== 'outOfRange' && id in review.decisions).length;
    return {
      ignored: { count: totals.ignored, decided },
      outOfRange: (items ?? []).filter((item) => item.kind !== 'formatting' && outOfRange.has(item.id)).length,
    };
  }, [ignored, range, review.decisions, items, outOfRange, totals.ignored]);

  const setFile = useCallback((role: DocumentRole, file: File) => {
    setFiles((current) => ({ ...current, [role]: file }));
    setResumeNotice(null);
  }, []);
  const swap = useCallback(() => setFiles(({ original, edited }) => ({ original: edited, edited: original })), []);

  const download = async (current: Comparison, state: DecisionState, undecided: UndecidedChoice) => {
    if (!engine) return;
    setExportState({ status: 'running', startedAt: performance.now() });
    try {
      const decisions = Object.fromEntries(finalRevisionDecisions(current.analysis.items, state, range, undecided, ignored));
      const bytes = await engine.exportDocx({
        redline: current.result.redline.slice(0),
        revisions: current.result.revisions,
        decisions,
        formattingChoice: state.formattingChoice,
        outOfRange: current.analysis.items.filter((item) => outOfRange.has(item.id)).flatMap((item) => item.revisionIds),
      });
      saveDocx(bytes, reviewedFileName(current.editedName));
      setExportState({ status: 'idle' });
      setExportOpen(false);
    } catch (error) {
      const labels = new Map<string, string>();
      for (const entry of buildReviewList(reviewable, formatting, true)) if (entry.type === 'item') labels.set(entry.item.id, entry.label);
      setExportState({ status: 'error', failure: exportFailure(error, current.analysis.items, labels) });
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
            onDownload={openExport}
            downloading={exportState.status === 'running'}
            onClose={() => setCloseOpen(true)}
            onPrevious={() => onShortcut('previous')}
            onNext={() => onShortcut('next')}
            navigationDisabled={order.length === 0}
            helpOpen={helpOpen}
            onHelpOpenChange={setHelpOpen}
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
        inputsHadRevisions={comparison?.result.inputsHadRevisions ?? false}
        storageUnavailable={storage.status === 'unavailable' && !storageNoticeDismissed}
        onDismissStorage={() => setStorageNoticeDismissed(true)}
        resumeNotice={resumeNotice}
        onDismissResume={() => setResumeNotice(null)}
      />

      {comparison && (
        <RangeControl
          key={reviewKey}
          range={rangeState}
          paragraphCount={comparison.analysis.index.bodyParagraphs.length}
          suggestedEndPoint={comparison.analysis.suggestedEndPoint}
          onChange={setRangeState}
          spanning={spanning}
          picking={picking}
          onPickingChange={setPicking}
        />
      )}

      {comparison ? (
        <div className="workspace">
          <div className="panels">
            {(['left', 'right'] as const).map((side) => (
              <DocumentPanel
                key={side}
                ref={side === 'left' ? leftRef : rightRef}
                side={side}
                title={side === 'left' ? comparison.originalName : comparison.editedName}
                document={comparison.document}
                ignored={ignored}
                settings={settings}
                decisions={review.decisions}
                currentItemId={currentItemId}
                onChangeClick={onChangeClick}
                overviewItems={reviewable}
                outOfRangeItems={outOfRange}
                outOfRangeBlocks={side === 'left' ? outsideBlocks : undefined}
                onPickParagraph={side === 'left' && picking ? pickParagraph : undefined}
              />
            ))}
          </div>
          <ChangesList
            entries={entries}
            decisions={review.decisions}
            currentItemId={currentItemId}
            onSelect={selectFromList}
            onDecide={decide}
            onDecideAllUndecided={(decision) =>
              dispatch({ type: decision === 'accepted' ? 'acceptAllUndecided' : 'rejectAllUndecided', itemIds: reviewable.map((item) => item.id) })
            }
            formattingChoice={review.formattingChoice}
            onFormattingChoice={(choice) => dispatch({ type: 'setFormattingChoice', choice })}
            formattingExpanded={formattingExpanded}
            onFormattingExpanded={setFormattingExpanded}
            totals={totals}
          />
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
      {comparison && exportOpen && (
        <ExportDialog
          undecided={totals.text.undecided}
          formattingCount={totals.formatting}
          formattingChoice={review.formattingChoice}
          onFormattingChoice={(choice) => dispatch({ type: 'setFormattingChoice', choice })}
          ignored={exportCounts.ignored}
          outOfRange={rangeState.endPoint === null ? null : { endPoint: rangeState.endPoint, count: exportCounts.outOfRange }}
          status={exportState}
          onDownload={(undecided) => void download(comparison, review, undecided)}
          onCancel={closeExport}
        />
      )}
      {offeredReview && engine && (
        <ResumePrompt
          originalName={offeredReview.original.name}
          editedName={offeredReview.edited.name}
          savedAt={offeredReview.savedAt}
          disabled={checkingSaved}
          onResume={() => void resume(offeredReview)}
          onStartNew={startNew}
          onDiscard={discardSaved}
        />
      )}
      {closeOpen && (
        <ConfirmDialog title="Close this review?" confirmLabel="Close review" onConfirm={closeReview} onCancel={() => setCloseOpen(false)}>
          Your decisions and the copy of both documents kept in this browser are deleted. Download the reviewed
          document first if you need it.
        </ConfirmDialog>
      )}
      {settingsOpen && (
        <CompareSettingsDialog settings={settings} onChange={setSettings} onClose={() => setSettingsOpen(false)} />
      )}
    </main>
  );
}

function Notices(props: {
  comparisonRunning: { startedAt: number; stage: ProgressStage | null } | null;
  comparisonError: string | null;
  inputsHadRevisions: boolean;
  storageUnavailable: boolean;
  onDismissStorage: () => void;
  resumeNotice: string | null;
  onDismissResume: () => void;
}) {
  const { comparisonRunning, comparisonError } = props;
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
      {props.inputsHadRevisions && (
        <p className="notice notice--info">
          At least one of the documents already contained tracked changes. They were compared as if those changes had
          been accepted.
        </p>
      )}
      {props.resumeNotice && (
        <p className="notice notice--info">
          {props.resumeNotice}
          <DismissButton onClick={props.onDismissResume} />
        </p>
      )}
      {props.storageUnavailable && (
        <p className="notice notice--info" data-testid="storage-unavailable">
          This browser does not allow saving here (e.g. in a private window, or its storage is full), so the review
          will not be remembered when the page is closed.
          <DismissButton onClick={props.onDismissStorage} />
        </p>
      )}
    </div>
  );
}

function DismissButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="notice__dismiss" aria-label="Dismiss" onClick={onClick}>
      ×
    </button>
  );
}
