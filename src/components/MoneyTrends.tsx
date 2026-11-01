import { useState, type ReactNode } from "react";
import { localDate, type MonthTotals } from "../api";
import {
  breakdown,
  changeSize,
  changeText,
  changeTone,
  compareWeeks,
  direction,
  longDate,
  monthName,
  monthsOf,
  pounds,
  previousWeek,
  rangeMonths,
  savingsRate,
  weekdayName,
  weekFor,
  weekLabel,
  weekTotals,
  yearIsCut,
  type BreakdownRow,
  type DayTotals,
  type TrendRange,
  type WeekBounds,
} from "../money";
import { useWeekTransactions } from "../useWeekTransactions";
import { CardHead, Metric, MetricHead } from "./Card";
import { BarChart, type Series } from "./BarChart";
import { SegmentedTabs } from "./SegmentedTabs";
import "../styles/money-trends.css";

const FLOWS: Series<MonthTotals>[] = [
  { key: "income", name: "Income", color: "var(--c-done)", value: (t) => t.income / 100 },
  { key: "spent", name: "Spent", color: "var(--cat-money)", value: (t) => t.spent / 100 },
];

const SPENT_BY_DAY: Series<DayTotals>[] = [
  { key: "spent", name: "Spent", color: "var(--cat-money)", value: (d) => d.spent / 100 },
];

const PANEL_ID = "money-trends-panel";
/** Charts are this tall so the card fits beside the transactions. */
const CHART_HEIGHT = 180;
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

/** How a month's breakdown names its month and the month before. */
function monthPeriod(current: string, previous: string | null) {
  return {
    currentName: monthName(current),
    previousName: previous ? monthName(previous) : null,
    aside: previous ? (
      <>
        {monthName(current)} vs {shortMonth(previous)}
      </>
    ) : (
      monthName(current)
    ),
    against: "last month",
  };
}

/**
 * A ranked list of horizontal bars: one row per category, its bar scaled to
 * the largest, the amount right-aligned and the change against the period
 * before. Every row has a screen-reader table under it (ui-spec C4). Months
 * and weeks share it.
 */
function Breakdown({
  id,
  title,
  rows,
  color,
  currentName,
  previousName,
  aside,
  against,
  upIsGood,
  empty,
}: {
  id: string;
  title: string;
  rows: BreakdownRow[];
  color: string;
  /** The period shown, e.g. "October" or "26 Oct – 1 Nov". */
  currentName: string;
  /** The period compared with, or null when it has no data to compare with. */
  previousName: string | null;
  aside: ReactNode;
  /** How the change names the period before, e.g. "last month". */
  against: string;
  upIsGood: boolean;
  empty: string;
}) {
  const shown = rows.filter((r) => r.current > 0 || r.previous > 0);
  const largest = Math.max(0, ...shown.map((r) => r.current));
  const hasAny = shown.some((r) => r.current > 0);
  const compare = previousName !== null;
  return (
    <section className="chart-block" aria-labelledby={id}>
      <MetricHead as="h3" id={id} label={title} color="var(--cat-money)" aside={aside} />
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
                {compare && (
                  <span className="breakdown__change">
                    <ChangeLine diff={r.current - r.previous} upIsGood={upIsGood} />
                  </span>
                )}
              </li>
            ))}
          </ol>
          <table className="sr-only">
            <caption>
              {title}, {currentName}
              {compare ? ` against ${previousName}` : ""}
            </caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                {compare && <th scope="col">{previousName}</th>}
                <th scope="col">{currentName}</th>
                {compare && <th scope="col">Change</th>}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.other ? "\u0000other" : r.category}>
                  <th scope="row">{r.category}</th>
                  {compare && <td>{pounds(r.previous)}</td>}
                  <td>{pounds(r.current)}</td>
                  {compare && <td>{changeText(r.current - r.previous, against, "pence")}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

/**
 * The week range (ui-spec P7): the week holding today, or the last whole
 * week of an earlier month. Spending per day, Spent and Income against the
 * week before, and the week's categories. It is built from transactions, so
 * the months the two weeks touch are fetched here; a failure is one muted
 * line, never a page error.
 */
function WeekView({ month, reload }: { month: string; reload: unknown }) {
  const today = localDate();
  const current = today.startsWith(month);
  const week = weekFor(month, today);
  const before = previousWeek(week);
  const { loading, rows, failed } = useWeekTransactions(
    monthsOf(before.start, week.end),
    true,
    reload,
  );
  const missing = (w: WeekBounds) => monthsOf(w.start, w.end).some((m) => failed.includes(m));

  if (loading) {
    return (
      <p className="muted money-trends__note" role="status">
        Loading the week…
      </p>
    );
  }
  if (missing(week)) {
    return <p className="muted money-trends__note">Could not load this week.</p>;
  }

  const lastMissing = missing(before);
  const now = weekTotals(rows, week);
  const then = weekTotals(rows, before);
  const vs = lastMissing ? null : compareWeeks(now, then);
  const label = weekLabel(week);
  const againstName = current ? "last week" : "the week before";
  const thisName = current ? "this week" : "that week";
  const unavailable = <span className="muted">Could not load {againstName}</span>;

  return (
    <>
      <div className="money-trends__totals">
        <Metric
          label={current ? "Spent this week" : "Spent that week"}
          color="var(--cat-money)"
          value={pounds(now.spent)}
          aside={label}
          detail={
            lastMissing
              ? unavailable
              : vs && <ChangeLine diff={vs.spent} previous={againstName} upIsGood={false} />
          }
        />
        <Metric
          label={current ? "Income this week" : "Income that week"}
          color="var(--cat-money)"
          value={pounds(now.income)}
          aside={label}
          detail={
            lastMissing
              ? unavailable
              : vs && <ChangeLine diff={vs.income} previous={againstName} upIsGood />
          }
        />
      </div>
      <div className="money-trends__blocks">
        <section className="chart-block" aria-labelledby="chart-week-days">
          <MetricHead
            as="h3"
            id="chart-week-days"
            label="Spending by day"
            color="var(--cat-money)"
            aside={<>£, {label}</>}
          />
          {now.spent === 0 ? (
            <p className="muted">No spending {thisName}.</p>
          ) : (
            <>
              <div aria-hidden="true">
                <BarChart
                  data={now.days}
                  label={(d) => weekdayName(d.date)}
                  series={SPENT_BY_DAY}
                  height={CHART_HEIGHT}
                />
              </div>
              <table className="sr-only">
                <caption>Spending by day, {label}</caption>
                <thead>
                  <tr>
                    <th scope="col">Day</th>
                    <th scope="col">Spent</th>
                    <th scope="col">Income</th>
                  </tr>
                </thead>
                <tbody>
                  {now.days.map((d) => (
                    <tr key={d.date}>
                      <th scope="row">{longDate(d.date)}</th>
                      <td>{pounds(d.spent)}</td>
                      <td>{pounds(d.income)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>

        <Breakdown
          id="chart-week-categories"
          title="Spending by category"
          rows={breakdown(now.spending, vs ? then.spending : [])}
          color="var(--c-progress)"
          currentName={label}
          previousName={vs ? weekLabel(before) : null}
          aside={
            vs ? (
              <>
                {label} vs {againstName}
              </>
            ) : (
              label
            )
          }
          against={againstName}
          upIsGood={false}
          empty={`No spending ${thisName}.`}
        />
      </div>
    </>
  );
}

export function MoneyTrends({ trend }: { trend: MonthTotals[] }) {
  const [range, setRange] = useState<TrendRange>("six");
  // After the first change of range, charts no longer draw in (ui-spec M7).
  const [settled, setSettled] = useState(false);
  // One breakdown at a time, so the card fits beside the transactions.
  const [kind, setKind] = useState<"spending" | "income">("spending");
  const anything = trend.some((t) => t.income > 0 || t.spent > 0);
  if (!anything)
    return (
      <section className="card money__trends" aria-labelledby="money-trends-title">
        <CardHead id="money-trends-title" title="Income and spending" />
        <p className="muted">
          No income or spending yet. Add a transaction or import a statement to see your trends.
        </p>
      </section>
    );

  const current = trend[trend.length - 1];
  const before = trend.length >= 2 ? trend[trend.length - 2] : null;
  const previous = before && (before.income > 0 || before.spent > 0) ? before : null;
  const year = current.month.slice(0, 4);
  const today = localDate();
  const yearLabel = today.startsWith(year) ? "This year" : year;
  // An earlier month shows its last whole week, which is not "this" week.
  const weekTab = today.startsWith(current.month) ? "This week" : "Week";
  const shown = rangeMonths(trend, range);
  const rates = shown.map(savingsRate);
  const cut = range === "year" && yearIsCut(trend);

  return (
    <section className="card money__trends" aria-labelledby="money-trends-title">
      <CardHead
        id="money-trends-title"
        title="Income and spending"
        action={
          <SegmentedTabs
            items={[
              { id: "week", label: weekTab },
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
      />
      <div
        role="tabpanel"
        id={PANEL_ID}
        aria-labelledby={tabId(range)}
        className="money-trends"
        data-settled={settled ? "" : undefined}
      >
        {range === "week" ? (
          <WeekView month={current.month} reload={trend} />
        ) : (
          <>
            {cut && (
              <p className="muted money-trends__note">
                Showing {monthName(shown[0].month)} to {monthName(current.month)} only: trends cover
                the last six months, so earlier months of {year} are not included.
              </p>
            )}
            <div className="money-trends__blocks">
              <section className="chart-block" aria-labelledby="chart-flows">
                <MetricHead
                  as="h3"
                  id="chart-flows"
                  label="By month"
                  color="var(--cat-money)"
                  aside={
                    range === "six" ? <>£, last {shown.length} months</> : <>£, {year} so far</>
                  }
                />
                <div aria-hidden="true">
                  <BarChart
                    data={shown}
                    label={(t) => shortMonth(t.month)}
                    series={FLOWS}
                    layout="grouped"
                    height={CHART_HEIGHT}
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

              {kind === "spending" ? (
                <Breakdown
                  id="chart-categories"
                  title="Spending by category"
                  rows={breakdown(current.spending, previous?.spending ?? [])}
                  color="var(--cat-money)"
                  {...monthPeriod(current.month, previous?.month ?? null)}
                  upIsGood={false}
                  empty={`No spending in ${monthName(current.month)}.`}
                />
              ) : (
                <Breakdown
                  id="chart-income"
                  title="Income by source"
                  rows={breakdown(current.incomeBySource, previous?.incomeBySource ?? [])}
                  color="var(--c-done)"
                  {...monthPeriod(current.month, previous?.month ?? null)}
                  upIsGood
                  empty={`No income in ${monthName(current.month)}.`}
                />
              )}
              <button
                type="button"
                className="link-button card__action money-trends__switch"
                onClick={() => {
                  setKind(kind === "spending" ? "income" : "spending");
                }}
              >
                {kind === "spending" ? "Show income by source" : "Show spending by category"}
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
