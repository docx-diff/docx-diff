import { useEffect, useState } from 'react';
import type { CompareResult, ComparisonEngine, ProgressStage } from '../engine/types';
import { analyzeComparison, type Analysis } from '../model/analyze';
import type { ItemText } from '../model/equivalence';
import { prepareRenderedDocument, type RenderedDocument } from './renderedDocument';

export interface Comparison {
  originalName: string;
  editedName: string;
  result: CompareResult;
  analysis: Analysis;
  document: RenderedDocument;
  /** Each text change's paragraph text before and after it, for the compare settings. */
  itemTexts: Map<string, ItemText>;
  /** Milliseconds: the worker's compare request, and preparing the result on the main thread. */
  timings: { worker: number; prepare: number };
}

export type ComparisonState =
  | { status: 'idle' }
  | { status: 'running'; startedAt: number; stage: ProgressStage | null }
  | { status: 'done'; comparison: Comparison }
  | { status: 'error'; message: string };

/**
 * Compares the two files whenever the engine is ready and both are chosen, and again whenever
 * either changes (e.g. Swap). A result that arrives after the inputs changed is dropped.
 */
export function useComparison(engine: ComparisonEngine | null, original: File | null, edited: File | null): ComparisonState {
  const [state, setState] = useState<ComparisonState>({ status: 'idle' });

  useEffect(() => {
    if (!engine || !original || !edited) {
      setState({ status: 'idle' });
      return;
    }
    let active = true;
    const startedAt = performance.now();
    setState({ status: 'running', startedAt, stage: null });

    (async () => {
      const [originalBytes, editedBytes] = await Promise.all([original.arrayBuffer(), edited.arrayBuffer()]);
      const result = await engine.compare(originalBytes, editedBytes, (event) => {
        if (active) setState({ status: 'running', startedAt, stage: event.stage });
      });
      const workerMs = performance.now() - startedAt;
      if (!active) return;
      const prepareStart = performance.now();
      const { analysis, document, itemTexts } = prepareRenderedDocument(result.html, (parsed) =>
        analyzeComparison(result, () => parsed),
      );
      const comparison: Comparison = {
        originalName: original.name,
        editedName: edited.name,
        result,
        analysis,
        document,
        itemTexts,
        timings: { worker: Math.round(workerMs), prepare: Math.round(performance.now() - prepareStart) },
      };
      console.info('Comparison timings (ms):', { ...comparison.timings, engine: result.timings, analysis: analysis.timings });
      if (active) setState({ status: 'done', comparison });
    })().catch((error: unknown) => {
      if (active) setState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
    });

    return () => {
      active = false;
    };
  }, [engine, original, edited]);

  return state;
}
