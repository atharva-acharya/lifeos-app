import { useId, type CSSProperties } from "react";

/** One activity ring: progress towards a daily goal. */
export interface Ring {
  key: string;
  name: string;
  value: number;
  goal: number;
  color: string;
  unit?: string;
  /** Writes a value in the legend (e.g. "7 h 12 min"); overrides `unit`. */
  format?: (n: number) => string;
  /** One sentence on what to do next, shown under the legend line (ui-spec P3). */
  hint?: string;
}

/** Room around the rings for the stroke's round caps and the fill's glow, so
 *  nothing is ever clipped at the edge of the drawing. */
const PAD = 10;

/** Share of the goal reached, 0 to 1 (a ring is full at its goal). */
export function progress(value: number, goal: number): number {
  if (!(goal > 0) || !Number.isFinite(value) || value <= 0) return 0;
  return Math.min(1, value / goal);
}

function legendValue(r: Ring, n: number): string {
  if (r.format) return r.format(n);
  return `${Math.round(n).toLocaleString("en-GB")}${r.unit ?? ""}`;
}

/** The plain number of a value, without its unit, for the large legend. */
function bareValue(r: Ring, n: number): string {
  if (r.format) return r.format(n);
  return Math.round(n).toLocaleString("en-GB");
}

/** Concentric activity rings in the style of Apple Health. Each ring sits in
 *  a recessed track. The legend carries every value as text, so the drawing
 *  itself is decorative. `hero` draws thicker rings with a large legend. */
export function Rings({
  rings,
  size = 168,
  variant = "compact",
}: {
  rings: Ring[];
  size?: number;
  variant?: "compact" | "hero";
}) {
  const stroke = variant === "hero" ? 18 : 14;
  const gap = variant === "hero" ? 5 : 4;
  const centre = size / 2;
  const inset = `rings-inset-${useId().replace(/:/g, "")}`;
  const box = size + PAD * 2;
  return (
    <figure className={`rings rings--${variant}`}>
      <svg
        width={size}
        height={size}
        viewBox={`${String(-PAD)} ${String(-PAD)} ${String(box)} ${String(box)}`}
        role="presentation"
        focusable="false"
      >
        <defs>
          {/* A dark edge along the top of each track: the light comes from
              above, so the track reads as pressed into the card. */}
          <filter id={inset} x="-10%" y="-10%" width="120%" height="120%">
            <feOffset dy="1.5" in="SourceAlpha" result="offset" />
            <feComposite in="SourceAlpha" in2="offset" operator="out" result="edge" />
            <feGaussianBlur in="edge" stdDeviation="1" result="soft" />
            <feFlood floodColor="#000" floodOpacity="0.75" />
            <feComposite in2="soft" operator="in" result="shadow" />
            <feMerge>
              <feMergeNode in="SourceGraphic" />
              <feMergeNode in="shadow" />
            </feMerge>
          </filter>
        </defs>
        {rings.map((r, i) => {
          const radius = centre - stroke / 2 - i * (stroke + gap);
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
                strokeWidth={stroke}
              />
              <circle
                className="rings__well"
                cx={centre}
                cy={centre}
                r={radius}
                strokeWidth={stroke}
                filter={`url(#${inset})`}
              />
              <circle
                className="rings__fill"
                cx={centre}
                cy={centre}
                r={radius}
                stroke={r.color}
                strokeWidth={stroke}
                pathLength={1}
                style={
                  {
                    strokeDashoffset: 1 - p,
                    color: r.color,
                    // M6: motion.css staggers each ring's fill by its index.
                    "--ring-index": i,
                  } as CSSProperties
                }
                opacity={p > 0 ? 1 : 0}
              />
            </g>
          );
        })}
      </svg>
      <figcaption>
        <ul className="rings__legend">
          {rings.map((r) =>
            variant === "hero" ? (
              <li key={r.key}>
                <span className="rings__line">
                  <span className="rings__name" style={{ color: r.color }}>
                    {r.name}
                  </span>
                  {r.hint && <span className="rings__hint">{r.hint}</span>}
                </span>
                <span className="rings__big">
                  <span className="rings__number">{bareValue(r, r.value)}</span>
                  <span className="rings__of"> of {legendValue(r, r.goal)}</span>
                </span>
              </li>
            ) : (
              <li key={r.key}>
                <span className="bar-chart__swatch" style={{ background: r.color }} />
                <span className="rings__name">{r.name}</span>
                <span className="rings__value">
                  {legendValue(r, r.value)} / {legendValue(r, r.goal)}
                </span>
                {r.hint && <span className="rings__hint">{r.hint}</span>}
              </li>
            ),
          )}
        </ul>
      </figcaption>
    </figure>
  );
}
