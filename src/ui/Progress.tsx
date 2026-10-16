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
