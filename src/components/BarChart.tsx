import { useLayoutEffect, useRef, useState } from "react";

/** One stacked part of each bar; `color` is a CSS colour or token. */
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
  unit?: string;
  height?: number;
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

/** Small SVG bar chart (stacked when given several series). No chart library. */
export function BarChart<T>({
  data,
  label,
  series,
  max,
  unit = "",
  height = 240,
}: BarChartProps<T>) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(FALLBACK_WIDTH);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      if (el.clientWidth > 0) setWidth(el.clientWidth);
    };
    measure();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, []);

  const totals = data.map((d) => series.reduce((n, s) => n + s.value(d), 0));
  const { top, ticks } =
    max === undefined
      ? niceScale(Math.max(0, ...totals))
      : { top: max, ticks: [0, 25, 50, 75, 100].map((p) => (p / 100) * max) };
  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;
  const slot = data.length > 0 ? plotW / data.length : plotW;
  const barW = Math.max(2, Math.min(48, slot * 0.7));
  const y = (v: number) => PAD.top + plotH - (top > 0 ? (v / top) * plotH : 0);
  // Show every label when they fit, otherwise every second or third.
  const every = Math.max(1, Math.ceil(56 / Math.max(1, slot)));

  return (
    <div ref={ref} className="bar-chart">
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
        {data.map((d, i) => {
          const x = PAD.left + slot * i + (slot - barW) / 2;
          let base = 0;
          const parts = series.map((s) => ({ s, v: s.value(d) })).filter((p) => p.v > 0);
          return (
            <g key={label(d)}>
              {parts.map(({ s, v }, j) => {
                const y0 = y(base);
                base += v;
                const y1 = y(base);
                const last = j === parts.length - 1;
                const h = Math.max(0, y0 - y1);
                const r = last ? Math.min(4, barW / 2, h) : 0;
                return (
                  <path
                    key={s.key}
                    className="bar-chart__bar"
                    fill={s.color}
                    style={{ transformOrigin: `0 ${String(y(0))}px` }}
                    d={`M${String(x)},${String(y0)}V${String(y1 + r)}Q${String(x)},${String(y1)} ${String(x + r)},${String(y1)}H${String(x + barW - r)}Q${String(x + barW)},${String(y1)} ${String(x + barW)},${String(y1 + r)}V${String(y0)}Z`}
                  >
                    <title>{`${label(d)} · ${s.name}: ${String(v)}${unit}`}</title>
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
                  {label(d)}
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
