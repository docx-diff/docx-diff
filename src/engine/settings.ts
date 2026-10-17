// The one set of comparison settings the app uses. Rationale: docs/architecture.md.
export const COMPARE_SETTINGS = {
  /** Compare the accepted view of inputs that already contain tracked changes (FR-13). */
  preAcceptInputRevisions: true,
  /** Headers and footers are not compared (FR-11); the engine default is true. */
  compareHeadersFooters: false,
  /** Numbering labels that change only because of edits elsewhere are not changes (FR-12). */
  trackNumberingChanges: false,
  /** The engine default, listed for clarity. */
  detectMoves: true,
} as const;
