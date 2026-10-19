import { useCallback, useRef, useState } from 'react';
import { usePopoverDismiss } from './usePopoverDismiss';

/** What editing the Edited text does and doesn't do (PRD-33b): in the general Help and the Edited header's popover. */
export function EditingHelp() {
  return (
    <ul className="editing-help">
      <li>
        <strong>Editable</strong>, in the Edited panel’s header, lets you edit the Edited text one paragraph at a time: type, delete, replace or
        paste plain text. Paragraph breaks can’t be added or removed. Moved text, the text after the comparison range and some content, such as
        fields, can’t be edited.
      </li>
      <li>Your edits become changes like the editor’s: a new change starts accepted, and an edit inside a change keeps its decision.</li>
      <li>
        <strong>B</strong> and <strong>I</strong> (Ctrl+B, Ctrl+I) make the selected text bold or italic, or plain again. They are formatting
        changes: the formatting choice decides them, as it does the editor’s.
      </li>
      <li>
        There is no undo. ↺ after a change (while Editable is off) or on its card reverts your edit of that change, ↺ ¶ your edits in a paragraph,
        ↺ all every edit.
      </li>
      <li>Your edits are saved with the review.</li>
      <li>While the cursor is in the text, the keys type and the shortcuts are off; Escape leaves the text.</li>
    </ul>
  );
}

/** The **?** at the end of the Edited panel's header: a popover with `EditingHelp`. */
export function EditingHelpButton() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  usePopoverDismiss(open, close, containerRef);
  return (
    <div className="help editing-help-button" ref={containerRef}>
      <button
        type="button"
        className="button button--small revert-button format-button"
        aria-label="About editing"
        title="About editing"
        aria-expanded={open}
        aria-controls="editing-help-popover"
        onClick={() => setOpen((shown) => !shown)}
      >
        <span aria-hidden="true">?</span>
      </button>
      {open && (
        <div id="editing-help-popover" className="help__popover" role="dialog" aria-label="About editing">
          <h2>Editing</h2>
          <EditingHelp />
        </div>
      )}
    </div>
  );
}
