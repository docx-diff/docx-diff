import type { OutlineEntry } from '../model/outline';

interface Props {
  entries: readonly OutlineEntry[];
  /** Headings outside the comparison range: greyed. */
  outOfRangeBlocks: ReadonlySet<string>;
  /** Scrolls both panels to the heading. */
  onSelect: (unid: string) => void;
  /** Collapses the sidebar. */
  onHide: () => void;
}

/**
 * The outline sidebar (FR-24a): the Edited's headings (the Original's if it has none), indented by
 * level. Headings only one version has are marked like the panels mark the change: struck through
 * (deleted) or underlined (inserted).
 */
export function Outline({ entries, outOfRangeBlocks, onSelect, onHide }: Props) {
  const topLevel = Math.min(...entries.map((entry) => entry.level));
  return (
    <nav className="outline" aria-label="Outline">
      <div className="outline__header">
        <h2 className="outline__title">Outline</h2>
        <button type="button" className="button button--plain outline__hide" aria-label="Hide the outline" title="Hide the outline" onClick={onHide}>
          «
        </button>
      </div>
      <div className="outline__scroller" data-testid="outline">
        {entries.length === 0 ? (
          <p className="outline__empty">The documents have no headings.</p>
        ) : (
          <ul className="outline__list">
            {entries.map((entry) => {
              const version = !entry.inEdited ? ' outline__entry--deleted' : !entry.inOriginal ? ' outline__entry--inserted' : '';
              const outside = outOfRangeBlocks.has(entry.unid) ? ' outline__entry--out-of-range' : '';
              const title = !entry.inEdited ? 'Only in the Original' : !entry.inOriginal ? 'Only in the Edited' : undefined;
              return (
                <li key={entry.unid}>
                  <button
                    type="button"
                    className={`outline__entry${version}${outside}`}
                    style={{ paddingLeft: `${0.5 + (entry.level - topLevel) * 0.875}rem` }}
                    title={title ? `${entry.text} (${title})` : entry.text}
                    onClick={() => onSelect(entry.unid)}
                  >
                    {entry.text}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </nav>
  );
}
