import { Progress, formatSeconds } from './Progress';
import type { EngineState } from './useEngine';

/**
 * The engine's state. Only an error is shown on screen (with Retry): while loading, the loading
 * modal shows the progress, and once ready there is nothing to say. The text stays available to
 * screen readers as a status.
 */
export function EngineStatus({ state, onRetry }: { state: EngineState; onRetry: () => void }) {
  const visible = state.status === 'error';
  return (
    <div
      className={`engine-status engine-status--${state.status}${visible ? '' : ' visually-hidden'}`}
      role="status"
      aria-live="polite"
    >
      {state.status === 'loading' && <Progress startedAt={state.startedAt} stage={state.stage ?? 'loading-engine'} />}
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
