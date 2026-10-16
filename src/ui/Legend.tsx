/** The highlight colours of the panels (FR-21). */
export function Legend() {
  return (
    <ul className="legend" aria-label="Legend">
      <li>
        <span className="legend__sample legend__sample--del">Deleted</span>
      </li>
      <li>
        <span className="legend__sample legend__sample--ins">Inserted</span>
      </li>
      <li>
        <span className="legend__sample legend__sample--move">Moved</span>
      </li>
    </ul>
  );
}
