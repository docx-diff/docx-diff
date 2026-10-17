import type { Theme } from './theme';

interface Props {
  theme: Theme;
  onToggle: () => void;
}

/** Icon button in the top bar switching between light and dark colours (FR-25a). */
export function ThemeToggle({ theme, onToggle }: Props) {
  const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  return (
    <button type="button" className="button button--icon theme-toggle" aria-label={label} title={label} onClick={onToggle}>
      <span aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span>
    </button>
  );
}
