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
