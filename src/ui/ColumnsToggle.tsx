interface Props {
  threeColumns: boolean;
  /** The window is too narrow for three columns: two are shown whatever the setting. */
  disabled: boolean;
  onToggle: () => void;
}

/** Vertical bars, as many as the view clicking switches to. */
function ColumnsIcon({ count }: { count: 2 | 3 }) {
  const width = 14 / count;
  return (
    <svg className="columns-toggle__icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <rect key={i} x={1 + i * width} y="2" width={width} height="12" rx="1" fill="none" stroke="currentColor" strokeWidth="1.25" />
      ))}
    </svg>
  );
}

/** Icon button in the top bar switching between two and three columns (FR-25c). */
export function ColumnsToggle({ threeColumns, disabled, onToggle }: Props) {
  const label = disabled ? 'The window is too narrow for three columns' : threeColumns ? 'Show two columns' : 'Show three columns';
  return (
    <button
      type="button"
      className="button button--icon columns-toggle"
      aria-label={label}
      title={label}
      aria-pressed={threeColumns && !disabled}
      disabled={disabled}
      onClick={onToggle}
    >
      <ColumnsIcon count={threeColumns && !disabled ? 2 : 3} />
    </button>
  );
}
