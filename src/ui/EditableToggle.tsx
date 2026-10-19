import type { FormatProperty } from '../model/paragraphEdit';

/** The Edited panel header's toggle for inline edits; pressed while the panel's text can be edited. */
export function EditableToggle({ editing, onToggle }: { editing: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="button button--small editable-toggle"
      title={editing ? 'Stop editing' : 'Edit the Edited text (simple edits within a paragraph)'}
      aria-label="Editable"
      aria-pressed={editing}
      onClick={onToggle}
    >
      <svg className="editable-toggle__icon" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
        <path d="M11.5 1.5a1.8 1.8 0 0 1 2.5 0l.5.5a1.8 1.8 0 0 1 0 2.5L5 14l-4 1 1-4z" fill="currentColor" />
      </svg>
      <span className="editable-toggle__label">Editable</span>
    </button>
  );
}

/**
 * Bold and Italic for the selected text, right after the toggle; disabled while Editable is off. A
 * press keeps the focus, and so the selection, in the text: the panel applies it to the selection
 * the cursor last had in an editable paragraph (`PanelControl.format`).
 */
export function FormatButtons({ editing, onFormat }: { editing: boolean; onFormat: (property: FormatProperty) => void }) {
  const button = (property: FormatProperty, label: string, letter: string) => (
    <button
      type="button"
      className={`button button--small revert-button format-button format-button--${property}`}
      title={`${label} (Ctrl+${letter})`}
      aria-label={label}
      disabled={!editing}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onFormat(property)}
    >
      <span aria-hidden="true">{letter}</span>
    </button>
  );
  return (
    <>
      {button('bold', 'Bold', 'B')}
      {button('italic', 'Italic', 'I')}
    </>
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
