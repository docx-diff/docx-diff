import { useEffect, useState } from 'react';
import type { ProgressStage } from '../engine/types';
import type { EngineState } from './useEngine';

const STAGE_LABELS: Record<ProgressStage, string> = {
  'loading-engine': 'Downloading the comparison engine',
  'warming-up': 'Starting the comparison engine',
};

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

/** Elapsed time since `startedAt`, updated a few times per second. */
function useElapsed(startedAt: number): number {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(performance.now()), 200);
    return () => clearInterval(timer);
  }, [startedAt]);
  return Math.max(0, now - startedAt);
}

function Loading({ startedAt, stage }: { startedAt: number; stage: ProgressStage | null }) {
  const elapsed = useElapsed(startedAt);
  return (
    <span>
      {STAGE_LABELS[stage ?? 'loading-engine']}… {formatSeconds(elapsed)}
    </span>
  );
}

export function EngineStatus({ state, onRetry }: { state: EngineState; onRetry: () => void }) {
  return (
    <div className={`engine-status engine-status--${state.status}`} role="status" aria-live="polite">
      {state.status === 'loading' && <Loading startedAt={state.startedAt} stage={state.stage} />}
      {state.status === 'ready' && (
        <span title={`Loaded in ${formatSeconds(state.loadMs)} (.NET ${state.version.dotnet})`}>
          Engine ready · Docxodus {state.version.docxodus}
        </span>
      )}
      {state.status === 'error' && (
        <>
          <span>The comparison engine could not be loaded: {state.message}</span>{' '}
          <button type="button" onClick={onRetry}>
            Retry
          </button>
        </>
      )}
    </div>
  );
}
