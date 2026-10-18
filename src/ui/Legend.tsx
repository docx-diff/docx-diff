/** The highlight colours of the panels (FR-21), and in three-column view the Resolved column's marks. */
export function Legend({ threeColumns }: { threeColumns: boolean }) {
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
      {threeColumns && (
        <>
          <li title="In the Resolved column">
            <span className="legend__sample legend__sample--decided">Decided</span>
          </li>
          <li title="In the Resolved column">
            <span className="legend__sample legend__sample--pending">Undecided</span>
          </li>
        </>
      )}
    </ul>
  );
}
