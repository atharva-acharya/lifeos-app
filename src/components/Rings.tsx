/** One activity ring: progress towards a daily goal. */
export interface Ring {
  key: string;
  name: string;
  value: number;
  goal: number;
  color: string;
  unit?: string;
}

const STROKE = 14;
const GAP = 4;

/** Share of the goal reached, 0 to 1 (a ring is full at its goal). */
export function progress(value: number, goal: number): number {
  if (!(goal > 0) || !Number.isFinite(value) || value <= 0) return 0;
  return Math.min(1, value / goal);
}

/** Concentric activity rings in the style of Apple Health. The legend
 * carries every value as text, so the drawing itself is decorative. */
export function Rings({ rings, size = 168 }: { rings: Ring[]; size?: number }) {
  const centre = size / 2;
  return (
    <figure className="rings">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${String(size)} ${String(size)}`}
        role="presentation"
        focusable="false"
      >
        {rings.map((r, i) => {
          const radius = centre - STROKE / 2 - i * (STROKE + GAP);
          if (radius <= 0) return null;
          const p = progress(r.value, r.goal);
          return (
            <g key={r.key} transform={`rotate(-90 ${String(centre)} ${String(centre)})`}>
              <circle
                className="rings__track"
                cx={centre}
                cy={centre}
                r={radius}
                stroke={r.color}
              />
              <circle
                className="rings__fill"
                cx={centre}
                cy={centre}
                r={radius}
                stroke={r.color}
                pathLength={1}
                style={{ strokeDashoffset: 1 - p }}
                opacity={p > 0 ? 1 : 0}
              />
            </g>
          );
        })}
      </svg>
      <figcaption>
        <ul className="rings__legend">
          {rings.map((r) => (
            <li key={r.key}>
              <span className="bar-chart__swatch" style={{ background: r.color }} />
              <span className="rings__name">{r.name}</span>
              <span className="rings__value">
                {Math.round(r.value).toLocaleString("en-GB")}
                {r.unit ?? ""} / {Math.round(r.goal).toLocaleString("en-GB")}
                {r.unit ?? ""}
              </span>
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}
