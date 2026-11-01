import { useId } from "react";
import { useWidth } from "./useWidth";

/** One part of each bar (stacked) or one bar of each group (grouped); `color` is a CSS colour or token. */
export interface Series<T> {
  key: string;
  name: string;
  color: string;
  value: (d: T) => number;
}

export interface BarChartProps<T> {
  data: T[];
  label: (d: T) => string;
  series: Series<T>[];
  /** Fixed top of the y axis (e.g. 100 for percentages); otherwise a tidy round-up. */
  max?: number;
  /** Horizontal dashed reference, e.g. a sleep goal. */
  target?: { value: number; label: string };
  unit?: string;
  height?: number;
  /** Stacked parts of one bar (default), or one bar per series side by side. */
  layout?: "stacked" | "grouped";
}

const PAD = { top: 8, right: 8, bottom: 24, left: 36 };
const FALLBACK_WIDTH = 480;

/** Rounds `max` up to a tidy axis top with about four whole-number steps. */
export function niceScale(max: number, steps = 4): { top: number; ticks: number[] } {
  if (!(max > 0)) return { top: steps, ticks: Array.from({ length: steps + 1 }, (_, i) => i) };
  const raw = max / steps;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, ([1, 2, 5, 10].find((m) => m * pow >= raw) ?? 10) * pow);
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let t = 0; t <= top + step / 2; t += step) ticks.push(Math.round(t * 100) / 100);
  return { top, ticks };
}

/** Shortens `text` to about `px` wide at the 12 px axis font. */
export function fit(text: string, px: number): string {
  const max = Math.max(3, Math.floor(px / 7));
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Widest a bar may be in any layout (C4), and the gap between bars of one group. */
export const BAR_MAX = 24;
const GROUP_GAP = 4;

/** Path of a bar from `y0` (base) up to `y1`, rounded only at the top. */
function barPath(x: number, w: number, y0: number, y1: number, r: number): string {
  return `M${String(x)},${String(y0)}V${String(y1 + r)}Q${String(x)},${String(y1)} ${String(x + r)},${String(y1)}H${String(x + w - r)}Q${String(x + w)},${String(y1)} ${String(x + w)},${String(y1 + r)}V${String(y0)}Z`;
}

/** Small SVG bar chart: stacked or grouped when given several series. No chart library. */
export function BarChart<T>({
  data,
  label,
  series,
  max,
  target,
  unit = "",
  height = 240,
  layout = "stacked",
}: BarChartProps<T>) {
  const grouped = layout === "grouped" && series.length > 1;
  const [ref, width] = useWidth<HTMLDivElement>(FALLBACK_WIDTH);
  const gradient = `bars-${useId().replace(/:/g, "")}`;

  const totals = data.map((d) =>
    grouped
      ? Math.max(0, ...series.map((s) => s.value(d)))
      : series.reduce((n, s) => n + s.value(d), 0),
  );
  const { top, ticks } =
    max === undefined
      ? niceScale(Math.max(0, ...totals, target?.value ?? 0))
      : { top: max, ticks: [0, 25, 50, 75, 100].map((p) => (p / 100) * max) };
  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;
  const slot = data.length > 0 ? plotW / data.length : plotW;
  const groupBarW = Math.max(
    2,
    Math.min(BAR_MAX, (slot * 0.7 - GROUP_GAP * (series.length - 1)) / series.length),
  );
  const barW = grouped
    ? groupBarW * series.length + GROUP_GAP * (series.length - 1)
    : Math.max(2, Math.min(BAR_MAX, slot * 0.7));
  const y = (v: number) => PAD.top + plotH - (top > 0 ? (v / top) * plotH : 0);
  // Show every label when they fit, otherwise every second or third.
  const every = Math.max(1, Math.ceil(56 / Math.max(1, slot)));

  return (
    <div ref={ref} className="bar-chart">
      <svg width={width} height={height} role="presentation" focusable="false">
        <defs>
          {/* Lit from above: each bar is brightest at its top and fades down. */}
          {series.map((s) => (
            <linearGradient key={s.key} id={`${gradient}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" style={{ stopColor: s.color }} />
              <stop offset="1" style={{ stopColor: s.color, stopOpacity: 0.28 }} />
            </linearGradient>
          ))}
        </defs>
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
        {data.map((d, i) => {
          const x = PAD.left + slot * i + (slot - barW) / 2;
          const bars = grouped
            ? series.map((s, j) => {
                const v = s.value(d);
                const h = Math.max(0, y(0) - y(Math.max(0, v)));
                return {
                  s,
                  v,
                  x: x + j * (groupBarW + GROUP_GAP),
                  w: groupBarW,
                  y0: y(0),
                  h,
                  top: true,
                };
              })
            : (() => {
                let base = 0;
                const parts = series.map((s) => ({ s, v: s.value(d) })).filter((p) => p.v > 0);
                return parts.map(({ s, v }, j) => {
                  const y0 = y(base);
                  base += v;
                  return {
                    s,
                    v,
                    x,
                    w: barW,
                    y0,
                    h: Math.max(0, y0 - y(base)),
                    top: j === parts.length - 1,
                  };
                });
              })();
          return (
            <g key={label(d)}>
              {bars
                .filter((b) => b.v > 0)
                .map((b) => {
                  const r = b.top ? Math.min(4, b.w / 2, b.h) : 0;
                  return (
                    <path
                      key={b.s.key}
                      className="bar-chart__bar"
                      fill={`url(#${gradient}-${b.s.key})`}
                      style={{ transformOrigin: `0 ${String(y(0))}px` }}
                      d={barPath(b.x, b.w, b.y0, b.y0 - b.h, r)}
                    >
                      <title>{`${label(d)} · ${b.s.name}: ${String(b.v)}${unit}`}</title>
                    </path>
                  );
                })}
              {i % every === 0 && (
                <text
                  className="bar-chart__tick"
                  x={x + barW / 2}
                  y={height - 6}
                  textAnchor="middle"
                >
                  {fit(label(d), slot * every - 4)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {series.length > 1 && (
        <ul className="bar-chart__legend">
          {series.map((s) => (
            <li key={s.key}>
              <span className="bar-chart__swatch" style={{ background: s.color }} />
              {s.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
