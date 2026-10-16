import type { ReactNode } from 'react';

/**
 * Covers the page until the app is ready to use. `index.html` shows the same markup (styled
 * inline there) before the app's scripts have loaded; React replaces it with this one.
 */
export function LoadingModal({ detail }: { detail: ReactNode }) {
  return (
    <div className="loading-modal" role="dialog" aria-modal="true" aria-label="Loading" aria-busy="true">
      <div className="loading-modal__box">
        <div className="loading-modal__spinner" aria-hidden="true" />
        <p className="loading-modal__title">Loading…</p>
        <div className="loading-modal__detail">{detail}</div>
      </div>
    </div>
  );
}
