import { useState } from "react";
import { localDate, type MonthTotals } from "../api";
import {
  breakdown,
  changeSize,
  changeText,
  changeTone,
  direction,
  monthName,
  pounds,
  rangeMonths,
  savingsRate,
  yearIsCut,
  type BreakdownRow,
  type TrendRange,
} from "../money";
import { Group, MetricHead } from "./Card";
import { BarChart, type Series } from "./BarChart";
import { LineChart } from "./LineChart";
import { SegmentedTabs } from "./SegmentedTabs";
import "../styles/money-trends.css";

const FLOWS: Series<MonthTotals>[] = [
  { key: "income", name: "Income", color: "var(--c-done)", value: (t) => t.income / 100 },
  { key: "spent", name: "Spent", color: "var(--c-progress)", value: (t) => t.spent / 100 },
];

const PANEL_ID = "money-trends-panel";
const tabId = (r: TrendRange) => `money-range-${r}`;

function shortMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: "short" });
}

function Arrow({ diff, tone }: { diff: number; tone: "good" | "bad" }) {
  return (
    <span className={`change__mark change__mark--${tone}`} aria-hidden="true">
      {diff > 0 ? "↑" : "↓"}
    </span>
  );
}

/**
 * A change against an earlier period in words, e.g. "↑ £12.00 more than
 * September". Only the arrow and the word wear colour (ui-spec T3): orange
 * when the change is bad news, green when it is good.
 */
export function ChangeLine({
  diff,
  previous,
  unit = "pence",
  upIsGood,
}: {
  diff: number;
  /** What the change is against, e.g. "September"; omit for "£12.00 more". */
  previous?: string;
  unit?: "pence" | "points";
  upIsGood: boolean;
}) {
  const dir = direction(diff);
  const tone = changeTone(diff, upIsGood);
  if (dir === "same" || tone === null) {
    return <span className="change">{previous ? `Same as ${previous}` : "Same"}</span>;
  }
  return (
    <span className="change">
      <Arrow diff={diff} tone={tone} />{" "}
      {unit === "points" ? (
        <>
          {Math.abs(diff)} <abbr title="percentage points">pts</abbr>
        </>
      ) : (
        changeSize(diff, unit)
      )}{" "}
      <span className={`change__mark--${tone}`}>{dir}</span>
      {previous && <> than {previous}</>}
    </span>
  );
}

/**
 * A ranked list of horizontal bars: one row per category, its bar scaled to
 * the largest, the amount right-aligned and the change against last month.
 * Every row has a screen-reader table under it (ui-spec C4).
 */
function Breakdown({
  id,
  title,
  rows,
  color,
  current,
  previous,
  upIsGood,
  empty,
}: {
  id: string;
  title: string;
  rows: BreakdownRow[];
  color: string;
  current: string;
  /** Last month's key, or null when it has no data to compare with. */
  previous: string | null;
  upIsGood: boolean;
  empty: string;
}) {
  const shown = rows.filter((r) => r.current > 0 || r.previous > 0);
  const largest = Math.max(0, ...shown.map((r) => r.current));
  const hasAny = shown.some((r) => r.current > 0);
  return (
    <section className="card chart-card" aria-labelledby={id}>
      <MetricHead
        as="h3"
        id={id}
        label={title}
        color="var(--cat-money)"
        aside={
          previous ? (
            <>
              {monthName(current)} vs {shortMonth(previous)}
            </>
          ) : (
            monthName(current)
          )
        }
      />
      {!hasAny ? (
        <p className="muted">{empty}</p>
      ) : (
        <>
          <ol className="breakdown" aria-hidden="true">
            {shown.map((r) => (
              <li key={r.other ? "\u0000other" : r.category} className="breakdown__row">
                <span className={`breakdown__name${r.other ? " breakdown__name--other" : ""}`}>
                  {r.category}
                </span>
                <span className="breakdown__value">{pounds(r.current)}</span>
                <span className="breakdown__track">
                  <span
                    className="breakdown__bar"
                    style={{
                      width: `${String(largest > 0 ? (r.current / largest) * 100 : 0)}%`,
                      background: color,
                    }}
                  />
                </span>
                {previous && (
                  <span className="breakdown__change">
                    <ChangeLine diff={r.current - r.previous} upIsGood={upIsGood} />
                  </span>
                )}
              </li>
            ))}
          </ol>
          <table className="sr-only">
            <caption>
              {title}, {monthName(current)}
              {previous ? ` against ${monthName(previous)}` : ""}
            </caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                {previous && <th scope="col">{monthName(previous)}</th>}
                <th scope="col">{monthName(current)}</th>
                {previous && <th scope="col">Change</th>}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.other ? "\u0000other" : r.category}>
                  <th scope="row">{r.category}</th>
                  {previous && <td>{pounds(r.previous)}</td>}
                  <td>{pounds(r.current)}</td>
                  {previous && <td>{changeText(r.current - r.previous, "last month", "pence")}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

export function MoneyTrends({ trend }: { trend: MonthTotals[] }) {
  const [range, setRange] = useState<TrendRange>("six");
  // After the first change of range, charts no longer draw in (ui-spec M7).
  const [settled, setSettled] = useState(false);
  const anything = trend.some((t) => t.income > 0 || t.spent > 0);
  if (!anything) return null;

  const current = trend[trend.length - 1];
  const before = trend.length >= 2 ? trend[trend.length - 2] : null;
  const previous = before && (before.income > 0 || before.spent > 0) ? before : null;
  const year = current.month.slice(0, 4);
  const yearLabel = localDate().startsWith(year) ? "This year" : year;
  const shown = rangeMonths(trend, range);
  const labels = shown.map((t) => shortMonth(t.month));
  const rates = shown.map(savingsRate);
  const cut = range === "year" && yearIsCut(trend);

  return (
    <Group
      title="Trends"
      className="money__trends"
      bare
      action={
        <SegmentedTabs
          items={[
            { id: "six", label: "6 months" },
            { id: "year", label: yearLabel },
          ]}
          value={range}
          label="Trend range"
          tabId={tabId}
          panelId={() => PANEL_ID}
          onChange={(next) => {
            // Applied at once for mouse and keyboard alike (ui-spec M4).
            setSettled(true);
            setRange(next);
          }}
        />
      }
    >
      <div
        role="tabpanel"
        id={PANEL_ID}
        aria-labelledby={tabId(range)}
        className="money-trends"
        data-settled={settled ? "" : undefined}
      >
        {cut && (
          <p className="muted money-trends__note">
            Showing {monthName(shown[0].month)} to {monthName(current.month)} only: trends cover the
            last six months, so earlier months of {year} are not included.
          </p>
        )}
        <div className="grid grid--2">
          <section className="card chart-card" aria-labelledby="chart-flows">
            <MetricHead
              as="h3"
              id="chart-flows"
              label="Income and spending"
              color="var(--cat-money)"
              aside={range === "six" ? <>£, last {shown.length} months</> : <>£, {year} so far</>}
            />
            <div aria-hidden="true">
              <BarChart
                data={shown}
                label={(t) => shortMonth(t.month)}
                series={FLOWS}
                layout="grouped"
              />
            </div>
            <table className="sr-only">
              <caption>Income and spending by month</caption>
              <thead>
                <tr>
                  <th scope="col">Month</th>
                  <th scope="col">Income</th>
                  <th scope="col">Spent</th>
                  <th scope="col">Savings rate</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((t, i) => (
                  <tr key={t.month}>
                    <th scope="row">{t.month}</th>
                    <td>{pounds(t.income)}</td>
                    <td>{pounds(t.spent)}</td>
                    <td>{rates[i] === null ? "—" : `${String(rates[i])}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="card chart-card" aria-labelledby="chart-savings">
            <MetricHead
              as="h3"
              id="chart-savings"
              label="Savings rate"
              color="var(--cat-money)"
              aside={"Share of income kept"}
            />
            {/* The flows table above lists the same rates for screen readers. */}
            <div aria-hidden="true">
              <LineChart
                labels={labels}
                lines={[
                  {
                    key: "rate",
                    name: "Savings rate",
                    color: "var(--c-done)",
                    values: rates,
                    dots: true,
                  },
                ]}
                unit="%"
              />
            </div>
          </section>

          <Breakdown
            id="chart-categories"
            title="Spending by category"
            rows={breakdown(current.spending, previous?.spending ?? [])}
            color="var(--c-progress)"
            current={current.month}
            previous={previous?.month ?? null}
            upIsGood={false}
            empty={`No spending in ${monthName(current.month)}.`}
          />

          <Breakdown
            id="chart-income"
            title="Income by source"
            rows={breakdown(current.incomeBySource, previous?.incomeBySource ?? [])}
            color="var(--c-done)"
            current={current.month}
            previous={previous?.month ?? null}
            upIsGood
            empty={`No income in ${monthName(current.month)}.`}
          />
        </div>
      </div>
    </Group>
  );
}
