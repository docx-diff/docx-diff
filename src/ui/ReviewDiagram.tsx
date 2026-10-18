/** One line of text in a column: its width, and the change it shows, if any. */
type Line = [width: number, mark?: 'del' | 'ins' | 'move'];

const ORIGINAL: Line[] = [[150], [170, 'del'], [120], [160], [90, 'move'], [175], [140, 'del'], [110]];
const EDITED: Line[] = [[150], [175, 'ins'], [120], [160], [175], [140, 'ins'], [110], [90, 'move']];
const RESOLVED: Line[] = [[150], [175], [120], [160], [175], [140], [110], [90]];

/** The outline's entries: indent and width. */
const HEADINGS: [indent: number, width: number][] = [
  [0, 80],
  [12, 70],
  [12, 56],
  [0, 74],
  [12, 62],
  [24, 46],
  [0, 84],
  [12, 50],
];

/** The changes list's cards: the change each shows, and the width of its text. */
const CARDS: [mark: 'del' | 'ins' | 'move', width: number][] = [
  ['del', 74],
  ['ins', 60],
  ['move', 50],
  ['ins', 66],
];

const TOP = 34;
const COLUMN_WIDTH = 200;
const COLUMN_HEIGHT = 230;
const LINE_STEP = 22;

function Column({ x, title, lines, resolved = false }: { x: number; title: string; lines: Line[]; resolved?: boolean }) {
  return (
    <g>
      <rect className={`review-diagram__page${resolved ? ' review-diagram__page--resolved' : ''}`} x={x} y={TOP} width={COLUMN_WIDTH} height={COLUMN_HEIGHT} rx="6" />
      <text className="review-diagram__title" x={x + COLUMN_WIDTH / 2} y={TOP - 10} textAnchor="middle">
        {title}
      </text>
      {lines.map(([width, mark], i) => (
        <rect
          key={i}
          className={`review-diagram__line${mark ? ` review-diagram__line--${mark}` : ''}`}
          x={x + 14}
          y={TOP + 20 + i * LINE_STEP}
          width={width}
          height="8"
          rx="2"
        />
      ))}
    </g>
  );
}

/** A horizontal arrow from `from` to `to` (either direction) at height `y`. */
function Arrow({ from, to, y }: { from: number; to: number; y: number }) {
  const tip = to > from ? -1 : 1;
  return (
    <g className="review-diagram__arrow">
      <line x1={from} y1={y} x2={to + tip * 6} y2={y} />
      <path d={`M ${to} ${y} l ${tip * 9} -6 v 12 z`} />
    </g>
  );
}

/**
 * Sketch of the review screen for the empty state: the outline, the Original, the Resolved text
 * the decisions give, the Edited, and the changes list, with a note on the sidebars' « and » buttons.
 */
export function ReviewDiagram() {
  return (
    <figure className="review-diagram">
      <svg
        viewBox="0 0 1000 310"
        role="img"
        aria-label="The review screen: the outline on the left, then the Original, the Resolved text and the Edited in three columns, and the changes list on the right. The Original and the Edited feed into the Resolved column. Both sidebars open and collapse with their « and » buttons."
      >
        {/* Outline */}
        <rect className="review-diagram__sidebar" x="0" y={TOP} width="130" height={COLUMN_HEIGHT} rx="6" />
        <text className="review-diagram__title" x="65" y={TOP - 10} textAnchor="middle">
          Outline
        </text>
        <text className="review-diagram__hide" x="114" y={TOP + 19} textAnchor="middle">
          «
        </text>
        {HEADINGS.map(([indent, width], i) => (
          <rect key={i} className="review-diagram__heading" x={12 + indent} y={TOP + 32 + i * 22} width={width} height="7" rx="2" />
        ))}

        <Column x={150} title="Original" lines={ORIGINAL} />
        <Column x={400} title="Resolved" lines={RESOLVED} resolved />
        <Column x={650} title="Edited" lines={EDITED} />
        <Arrow from={356} to={394} y={TOP + COLUMN_HEIGHT / 2} />
        <Arrow from={644} to={606} y={TOP + COLUMN_HEIGHT / 2} />

        {/* Changes list */}
        <rect className="review-diagram__sidebar" x="870" y={TOP} width="130" height={COLUMN_HEIGHT} rx="6" />
        <text className="review-diagram__title" x="935" y={TOP - 10} textAnchor="middle">
          Changes
        </text>
        <text className="review-diagram__hide" x="886" y={TOP + 19} textAnchor="middle">
          »
        </text>
        {CARDS.map(([mark, width], i) => {
          const y = TOP + 30 + i * 49;
          return (
            <g key={i}>
              <rect className="review-diagram__card" x="898" y={y} width="94" height="41" rx="4" />
              <rect className={`review-diagram__line review-diagram__line--${mark}`} x="905" y={y + 8} width={width} height="7" rx="2" />
              <rect className="review-diagram__accept" x="905" y={y + 22} width="24" height="11" rx="2" />
              <rect className="review-diagram__reject" x="933" y={y + 22} width="24" height="11" rx="2" />
            </g>
          );
        })}

        {/* The sidebars' hide buttons, circled, and the note on them */}
        <g className="review-diagram__note">
          <circle cx="114" cy={TOP + 13} r="11" />
          <circle cx="886" cy={TOP + 13} r="11" />
          <circle cx="162" cy="292" r="11" />
          <circle cx="192" cy="292" r="11" />
        </g>
        <text className="review-diagram__note-text" x="0" y="298">
          Open/collapse with
        </text>
        <text className="review-diagram__hide" x="162" y="298" textAnchor="middle">
          «
        </text>
        <text className="review-diagram__hide" x="192" y="298" textAnchor="middle">
          »
        </text>
      </svg>
    </figure>
  );
}
