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
} from './model/decisions';
import { ignoredItems } from './model/equivalence';
import { blockPositions, classify, initialRange, outOfRangeBlocks, spanningItems, type RangeClass, type RangeState } from './model/range';
import { buildReviewList, navigationOrder, nextUndecided, step } from './model/reviewList';
import { ChangesList } from './ui/ChangesList';
import { CompareSettingsDialog } from './ui/CompareSettingsDialog';
import { DocumentPanel } from './ui/DocumentPanel';
import { EngineStatus } from './ui/EngineStatus';
import { FileDropZones, type DocumentRole } from './ui/FileDropZones';
import { LoadingModal } from './ui/LoadingModal';
import { Progress } from './ui/Progress';
import { RangeControl } from './ui/RangeControl';
import { Toolbar } from './ui/Toolbar';
import { reviewedFileName, saveDocx } from './ui/download';
import { useComparison, type Comparison } from './ui/useComparison';
import { useCompareSettings } from './ui/useCompareSettings';
import { useEngine } from './ui/useEngine';
import { revealItem } from './ui/reveal';
import { useScrollSync } from './ui/scrollSync';
import { useKeyboardShortcuts, type ShortcutAction } from './ui/useKeyboardShortcuts';

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
  if (comparison !== reviewedComparison) {
    setReviewedComparison(comparison);
    dispatch({ type: 'clear' });
    setCurrentItemId(null);
    setFormattingExpanded(false);
    setRangeState(initialRange(comparison?.analysis.suggestedEndPoint ?? null));
    setPicking(false);
  }

  const items = comparison?.analysis.items;
  // The comparison range only reclassifies the changes (FR-19); their decisions are kept.
  const positions = useMemo(() => (comparison ? blockPositions(comparison.analysis.index) : new Map<string, number>()), [comparison]);
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
  /** A click on a paragraph of the Original while picking: it becomes the last paragraph in range. */
  const pickParagraph = useCallback(
    (unids: string[]) => {
      const at = unids.map((unid) => paragraphIndex.get(unid)).find((i) => i !== undefined);
      if (at === undefined || at + 1 >= paragraphIndex.size) return;
      setRangeState({ mode: 'manual', endPoint: at + 1 });
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

  const [exportState, setExportState] = useState<ExportState>({ status: 'idle' });

  const setFile = useCallback((role: DocumentRole, file: File) => setFiles((current) => ({ ...current, [role]: file })), []);
  const swap = useCallback(() => setFiles(({ original, edited }) => ({ original: edited, edited: original })), []);

  const download = async (current: Comparison, state: DecisionState) => {
    if (!engine) return;
    setExportState({ status: 'running', startedAt: performance.now() });
    try {
      // Undecided changes are accepted until the export dialog lets the reviewer choose.
      const decisions = Object.fromEntries(finalRevisionDecisions(current.analysis.items, state, range, 'accept', ignored));
      const bytes = await engine.exportDocx({
        redline: current.result.redline.slice(0),
        revisions: current.result.revisions,
        decisions,
        formattingChoice: state.formattingChoice,
        outOfRange: current.analysis.items.filter((item) => outOfRange.has(item.id)).flatMap((item) => item.revisionIds),
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
            onDownload={() => void download(comparison, review)}
            downloading={exportState.status === 'running'}
            summary={{ text: totals.text.total, formatting: totals.formatting, ignored: totals.ignored }}
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
        exportState={exportState}
        onDismissExportError={() => setExportState({ status: 'idle' })}
        inputsHadRevisions={comparison?.result.inputsHadRevisions ?? false}
      />

      {comparison && (
        <RangeControl
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
      {settingsOpen && (
        <CompareSettingsDialog settings={settings} onChange={setSettings} onClose={() => setSettingsOpen(false)} />
      )}
    </main>
  );
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
