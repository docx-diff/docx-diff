import { useEffect, useState } from 'react';
import type { ProgressStage } from '../engine/types';

const STAGE_LABELS: Record<ProgressStage, string> = {
  'loading-engine': 'Downloading the comparison engine',
  'warming-up': 'Starting the comparison engine',
  comparing: 'Comparing the documents',
  listing: 'Listing the changes',
  rendering: 'Rendering the documents',
  exporting: 'Preparing the download',
};

export function formatSeconds(ms: number): string {
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

/** "<what the engine is doing>… 1.2 s"; `label` overrides the stage's label. */
export function Progress({ startedAt, stage, label }: { startedAt: number; stage: ProgressStage | null; label?: string }) {
  const elapsed = useElapsed(startedAt);
  return (
    <span className="progress">
      <span className="progress__spinner" aria-hidden="true" />
      {label ?? (stage ? STAGE_LABELS[stage] : 'Working')}… {formatSeconds(elapsed)}
    </span>
  );
}

/**
 * The compare stages in order: the share of the bar each one fills, and how fast (seconds; the
 * sample pair takes ~3 s comparing, ~1 s listing, ~3.5 s rendering and preparing, see
 * docs/measurements.md).
 */
const COMPARE_STAGES: Partial<Record<ProgressStage, { from: number; to: number; seconds: number }>> = {
  comparing: { from: 0, to: 40, seconds: 2 },
  listing: { from: 40, to: 52, seconds: 0.6 },
  rendering: { from: 52, to: 99, seconds: 2.5 },
};

/**
 * Estimated percentage of a compare: the engine reports stages only, so within a stage the value
 * approaches the stage's end without reaching it. It never goes back when the next stage starts.
 */
export function estimatePercent(stage: ProgressStage, msInStage: number): number {
  const range = COMPARE_STAGES[stage];
  if (!range) return 0;
  const fraction = 1 - Math.exp(-msInStage / 1000 / range.seconds);
  return Math.floor(range.from + (range.to - range.from) * fraction);
}

const RING_RADIUS = 52;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/** The compare's progress card, in place of the drop zones: a ring that fills up, the percentage in it, the stage and the seconds below. */
export function CompareProgress({ startedAt, stage }: { startedAt: number; stage: ProgressStage }) {
  const elapsed = useElapsed(startedAt);
  // When the current stage began (React's "adjust state while rendering" pattern).
  const [current, setCurrent] = useState(() => ({ stage, since: performance.now() }));
  if (current.stage !== stage) setCurrent({ stage, since: performance.now() });
  const percent = estimatePercent(stage, Math.max(0, startedAt + elapsed - current.since));
  const label = STAGE_LABELS[stage];
  return (
    <div className="compare-progress" data-testid="compare-progress" aria-live="polite">
      <div
        className="compare-progress__ring"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <circle className="compare-progress__track" cx="60" cy="60" r={RING_RADIUS} />
          <circle
            className="compare-progress__fill"
            cx="60"
            cy="60"
            r={RING_RADIUS}
            strokeDasharray={RING_LENGTH}
            strokeDashoffset={RING_LENGTH * (1 - percent / 100)}
          />
        </svg>
        <span className="compare-progress__percent">{percent}%</span>
      </div>
      <p className="compare-progress__stage">{label}…</p>
      <p className="compare-progress__seconds">{formatSeconds(elapsed)}</p>
    </div>
  );
}
