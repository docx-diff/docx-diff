import { FileDropZone, type DocumentRole } from './FileDropZones';
import { HelpPopover } from './HelpPopover';
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
  onPrevious: () => void;
  onNext: () => void;
  /** No changes to step through. */
  navigationDisabled: boolean;
  helpOpen: boolean;
  onHelpOpenChange: (open: boolean) => void;
}

/** The toolbar above the panels once a comparison is shown. */
export function Toolbar(props: Props) {
  const { original, edited, onFile, onSwap, scrollLock, onScrollLockChange, onDownload, downloading } = props;
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
      <button type="button" className="button" onClick={props.onPrevious} disabled={props.navigationDisabled} title="Previous change (k or ↑)">
        ↑ Previous
      </button>
      <button type="button" className="button" onClick={props.onNext} disabled={props.navigationDisabled} title="Next change (j or ↓)">
        ↓ Next
      </button>
      <button type="button" className="button button--primary" onClick={onDownload} disabled={downloading}>
        Download…
      </button>
      <span className="toolbar__separator" />
      <Legend />
      <HelpPopover open={props.helpOpen} onOpenChange={props.onHelpOpenChange} />
    </div>
  );
}
