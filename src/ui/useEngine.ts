import { useCallback, useEffect, useState } from 'react';
import { EngineClient } from '../engine/client';
import type { ComparisonEngine, EngineVersion, ProgressStage } from '../engine/types';

export type EngineState =
  | { status: 'loading'; startedAt: number; stage: ProgressStage | null }
  | { status: 'ready'; engine: ComparisonEngine; version: EngineVersion; loadMs: number }
  | { status: 'error'; message: string };

/**
 * Starts the engine worker on mount and loads the engine. An engine that fails later (e.g. its worker
 * crashed) turns the state into an error too. `retry` replaces the worker with a new one, so it also
 * recovers from a worker that failed to start or crashed.
 */
export function useEngine(createEngine: () => ComparisonEngine = () => new EngineClient()): {
  state: EngineState;
  retry: () => void;
} {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<EngineState>(() => ({ status: 'loading', startedAt: performance.now(), stage: null }));

  useEffect(() => {
    const startedAt = performance.now();
    let active = true;
    const engine = createEngine();
    setState({ status: 'loading', startedAt, stage: null });
    const fail = (error: unknown) => {
      if (active) setState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
    };
    const unsubscribe = engine.onFailure(fail);
    engine
      .init((event) => {
        if (active) setState({ status: 'loading', startedAt, stage: event.stage });
      })
      .then((version) => {
        if (active) setState({ status: 'ready', engine, version, loadMs: performance.now() - startedAt });
      }, fail);
    return () => {
      active = false;
      unsubscribe();
      engine.dispose();
    };
    // createEngine is a factory for tests; a new one on each render must not restart the engine.
  }, [attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, retry };
}
