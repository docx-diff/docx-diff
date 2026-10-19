/** The Edited panel header's toggle for inline edits; pressed while the panel's text can be edited. */
export function EditableToggle({ editing, onToggle }: { editing: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="button button--small editable-toggle"
      title={editing ? 'Stop editing' : 'Edit the Edited text (simple edits within a paragraph)'}
      aria-pressed={editing}
      onClick={onToggle}
    >
      <svg className="editable-toggle__icon" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
        <path d="M11.5 1.5a1.8 1.8 0 0 1 2.5 0l.5.5a1.8 1.8 0 0 1 0 2.5L5 14l-4 1 1-4z" fill="currentColor" />
      </svg>
      Editable
    </button>
  );
}

/**
 * The Edited panel header's revert buttons after the toggle, whether or not Editable is on: ↺ ¶
 * reverts the edits of one paragraph (the cursor's while editing, else the current change's), ↺ all
 * every edit. Each asks first (the App's confirmation); disabled only when there is nothing to revert.
 */
export function RevertButtons({ paragraphEdited, anyEdits, onRevertParagraph, onRevertAll }: {
  paragraphEdited: boolean;
  anyEdits: boolean;
  onRevertParagraph: () => void;
  onRevertAll: () => void;
}) {
  return (
    <>
      <button
        type="button"
        className="button button--small revert-button"
        title="Revert my edits in this paragraph"
        aria-label="Revert my edits in this paragraph"
        disabled={!paragraphEdited}
        onClick={onRevertParagraph}
      >
        <span aria-hidden="true">↺ ¶</span>
      </button>
      <button
        type="button"
        className="button button--small revert-button"
        title="Revert all my edits"
        aria-label="Revert all my edits"
        disabled={!anyEdits}
        onClick={onRevertAll}
      >
        <span aria-hidden="true">↺ all</span>
      </button>
    </>
  );
}
