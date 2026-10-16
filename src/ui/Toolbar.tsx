import { FileDropZone, type DocumentRole } from './FileDropZones';
import { Legend } from './Legend';

interface Props {
  original: File | null;
  edited: File | null;
  onFile: (role: DocumentRole, file: File) => void;
  onSwap: () => void;
  scrollLock: boolean;
  onScrollLockChange: (locked: boolean) => void;
  onDownload: () => void;
  downloading: boolean;
  summary: { text: number; formatting: number; ignored: number };
}

/** The toolbar above the panels once a comparison is shown. */
export function Toolbar({ original, edited, onFile, onSwap, scrollLock, onScrollLockChange, onDownload, downloading, summary }: Props) {
  return (
    <div className="toolbar" role="toolbar" aria-label="Comparison">
      <FileDropZone role="original" file={original} onFile={onFile} compact />
      <button type="button" className="button" onClick={onSwap} title="Swap Original and Edited and compare again">
        ⇄ Swap
      </button>
      <FileDropZone role="edited" file={edited} onFile={onFile} compact />
      <span className="toolbar__separator" />
      <button
        type="button"
        className="button"
        aria-pressed={scrollLock}
        onClick={() => onScrollLockChange(!scrollLock)}
        title="Scroll both panels together"
      >
        {scrollLock ? '🔒' : '🔓'} Scroll lock
      </button>
      <button type="button" className="button button--primary" onClick={onDownload} disabled={downloading}>
        Download
      </button>
      <span className="toolbar__separator" />
      <span className="toolbar__summary" data-testid="change-summary">
        {summary.text} changes · {summary.formatting} formatting · {summary.ignored} ignored
      </span>
      <Legend />
    </div>
  );
}
