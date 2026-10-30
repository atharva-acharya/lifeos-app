import { fit } from "./BarChart";
import { useWidth } from "./useWidth";

/** One line; `null` values leave a gap (a day with no reading). */
export interface Line {
  key: string;
  name: string;
  color: string;
  values: (number | null)[];
  /** Draw a dot on each reading (the raw series, not an average). */
  dots?: boolean;
}

export interface LineChartProps {
  labels: string[];
  lines: Line[];
  /** Horizontal dashed reference, e.g. a target weight. */
  target?: { value: number; label: string };
  unit?: string;
  height?: number;
}

const PAD = { top: 12, right: 12, bottom: 24, left: 40 };

/** Fits the y axis to the data (not from zero) with tidy steps. */
export function niceRange(
  min: number,
  max: number,
  steps = 4,
): { lo: number; hi: number; ticks: number[] } {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { lo: 0, hi: 1, ticks: [0, 1] };
  if (min === max) {
    min -= 1;
    max += 1;
  } else if (max - min < 0.01) {
    // Tiny spans would round every tick to the same label.
    const mid = (min + max) / 2;
    min = mid - 0.005;
    max = mid + 0.005;
  }
  const raw = (max - min) / steps;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * pow >= raw) ?? 10) * pow;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let t = lo; t <= hi + step / 2; t += step) ticks.push(Math.round(t * 1000) / 1000);
  return { lo, hi, ticks };
}

/** SVG path for one line, broken into segments at gaps. */
export function linePath(
  values: (number | null)[],
  x: (i: number) => number,
  y: (v: number) => number,
): string {
  let d = "";
  let pen = false;
  values.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) {
      pen = false;
      return;
    }
    d += `${pen ? "L" : "M"}${String(x(i))},${String(y(v))}`;
    pen = true;
  });
  return d;
}

/**
 * Small SVG line chart (trends such as weight). No chart library.
 * Dot tooltips are mouse-only: like JobCharts, callers hide the plot from
 * screen readers (`aria-hidden`) and add an `sr-only` table of the values.
 */
export function LineChart({ labels, lines, target, unit = "", height = 220 }: LineChartProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const all = lines
    .flatMap((l) => l.values)
    .filter((v): v is number => v !== null && Number.isFinite(v));
  if (target) all.push(target.value);
  const { lo, hi, ticks } = niceRange(Math.min(...all), Math.max(...all));
  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;
  const x = (i: number) =>
    PAD.left + (labels.length > 1 ? (i / (labels.length - 1)) * plotW : plotW / 2);
  const y = (v: number) => PAD.top + plotH - ((v - lo) / (hi - lo)) * plotH;
  const slot = labels.length > 1 ? plotW / (labels.length - 1) : plotW;
  const every = Math.max(1, Math.ceil(64 / Math.max(1, slot)));

  return (
    <div ref={ref} className="line-chart">
      <svg width={width} height={height} role="presentation" focusable="false">
        {ticks.map((t) => (
          <g key={t}>
            <line
              className="bar-chart__grid"
              x1={PAD.left}
              x2={width - PAD.right}
              y1={y(t)}
              y2={y(t)}
            />
            <text
              className="bar-chart__tick"
              x={PAD.left - 6}
              y={y(t)}
              dy="0.32em"
              textAnchor="end"
            >
              {t}
              {unit}
            </text>
          </g>
        ))}
        {target && (
          <g className="line-chart__target">
            <line x1={PAD.left} x2={width - PAD.right} y1={y(target.value)} y2={y(target.value)} />
            <text x={width - PAD.right} y={y(target.value) - 4} textAnchor="end">
              {target.label}
            </text>
          </g>
        )}
        {lines.map((l) => (
          <g key={l.key}>
            <path
              className="line-chart__line"
              d={linePath(l.values, x, y)}
              stroke={l.color}
              pathLength={1}
            />
            {l.dots &&
              l.values.map((v, i) =>
                v === null || !Number.isFinite(v) ? null : (
                  <circle
                    key={i}
                    className="line-chart__dot"
                    cx={x(i)}
                    cy={y(v)}
                    r={3}
                    fill={l.color}
                  >
                    <title>{`${labels[i] ?? ""} · ${l.name}: ${String(v)}${unit}`}</title>
                  </circle>
                ),
              )}
          </g>
        ))}
        {labels.map((label, i) =>
          // Counted back from the newest day, so it is always labelled.
          (labels.length - 1 - i) % every === 0 ? (
            <text key={i} className="bar-chart__tick" x={x(i)} y={height - 6} textAnchor="middle">
              {fit(label, slot * every - 4)}
            </text>
          ) : null,
        )}
      </svg>
      {lines.length > 1 && (
        <ul className="bar-chart__legend">
          {lines.map((l) => (
            <li key={l.key}>
              <span className="bar-chart__swatch" style={{ background: l.color }} />
              {l.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
