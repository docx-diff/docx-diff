import { useId, useRef, useState, type DragEvent } from 'react';

export type DocumentRole = 'original' | 'edited';

const ROLE_LABELS: Record<DocumentRole, string> = { original: 'Original', edited: 'Edited' };

/** Every `.docx` is a zip package, which starts with a local file header: `PK\x03\x04`. */
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];

/**
 * Checks that a file looks like a `.docx`: the extension and the zip signature. Returns the
 * error message to show, or `null`. A zip that is not a valid Word document is only noticed by
 * the engine when comparing.
 */
export async function validateDocx(file: File): Promise<string | null> {
  if (!/\.docx$/i.test(file.name)) {
    return `“${file.name}” is not a Word document (.docx).`;
  }
  const head = new Uint8Array(await file.slice(0, ZIP_SIGNATURE.length).arrayBuffer());
  if (head.length < ZIP_SIGNATURE.length || ZIP_SIGNATURE.some((byte, i) => head[i] !== byte)) {
    return `“${file.name}” is damaged or not a real .docx file.`;
  }
  return null;
}

interface ZoneProps {
  role: DocumentRole;
  file: File | null;
  onFile: (role: DocumentRole, file: File) => void;
  /** One-line version for the toolbar. */
  compact?: boolean;
  disabled?: boolean;
}

/** A drop zone with a file picker for one of the two documents. */
export function FileDropZone({ role, file, onFile, compact = false, disabled = false }: ZoneProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const accept = async (files: FileList | null) => {
    const chosen = files?.[0];
    if (!chosen) return;
    const problem = await validateDocx(chosen);
    setError(problem);
    if (!problem) onFile(role, chosen);
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    if (!disabled) void accept(event.dataTransfer.files);
  };

  const label = ROLE_LABELS[role];
  return (
    <div
      className={['drop-zone', compact && 'drop-zone--compact', dragging && 'drop-zone--dragging'].filter(Boolean).join(' ')}
      data-testid={`drop-${role}`}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="visually-hidden"
        disabled={disabled}
        aria-label={`${label} document`}
        onChange={(event) => {
          void accept(event.target.files);
          event.target.value = '';
        }}
      />
      {compact ? (
        <label htmlFor={inputId} className="drop-zone__compact-label" title={file ? `${label}: ${file.name} — click or drop to replace` : undefined}>
          <span className="drop-zone__role">{label}</span> {file ? file.name : 'Choose…'}
        </label>
      ) : (
        <>
          <span className="drop-zone__role">{label}</span>
          {file ? <span className="drop-zone__file">{file.name}</span> : <span className="drop-zone__hint">Drop a .docx here</span>}
          <label htmlFor={inputId} className="button">
            {file ? 'Replace…' : 'Choose file…'}
          </label>
        </>
      )}
      {error && (
        <span className="drop-zone__error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

interface ZonesProps {
  original: File | null;
  edited: File | null;
  onFile: (role: DocumentRole, file: File) => void;
  onSwap: () => void;
  disabled?: boolean;
}

/** The empty state: one zone per document, Swap, and the note that files stay local. */
export function FileDropZones({ original, edited, onFile, onSwap, disabled }: ZonesProps) {
  return (
    <div className="drop-zones">
      <p className="drop-zones__intro">
        Choose the <strong>Original</strong> and the <strong>Edited</strong> Word document to compare. Your files stay on
        this computer: they are compared in the browser and never uploaded. The review, with both files, is kept in this
        browser so that you can resume it, until you close it or start another one.
      </p>
      <div className="drop-zones__row">
        <FileDropZone role="original" file={original} onFile={onFile} disabled={disabled} />
        <button type="button" className="button" onClick={onSwap} disabled={!original && !edited} title="Swap Original and Edited">
          ⇄ Swap
        </button>
        <FileDropZone role="edited" file={edited} onFile={onFile} disabled={disabled} />
      </div>
    </div>
  );
}
