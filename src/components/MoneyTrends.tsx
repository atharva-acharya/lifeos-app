import type { CategoryAmount, MonthTotals } from "../api";
import { pounds } from "../money";
import { BarChart, type Series } from "./BarChart";
import { LineChart, type Line } from "./LineChart";

/** Categories drawn as lines; the rest are in the month-on-month table. */
const TOP = 4;
const LINE_COLORS = ["var(--c-progress)", "var(--c-read)", "var(--ring-stand)", "var(--c-pending)"];

const FLOWS: Series<MonthTotals>[] = [
  { key: "income", name: "Income", color: "var(--c-done)", value: (t) => t.income / 100 },
  { key: "spent", name: "Spent", color: "var(--c-progress)", value: (t) => t.spent / 100 },
];

function shortMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: "short" });
}

/** Share of income kept, as a whole percent; null without income. */
export function savingsRate(t: { income: number; spent: number }): number | null {
  return t.income > 0 ? Math.round(((t.income - t.spent) / t.income) * 100) : null;
}

function amountOf(list: CategoryAmount[], category: string): number {
  return list.find((c) => c.category.toLowerCase() === category.toLowerCase())?.spent ?? 0;
}

/** Categories by spending over the whole window, largest first. */
export function topCategories(trend: MonthTotals[], n = TOP): string[] {
  const totals = new Map<string, { name: string; total: number }>();
  for (const t of trend) {
    for (const c of t.spending) {
      const key = c.category.toLowerCase();
      const entry = totals.get(key) ?? { name: c.category, total: 0 };
      entry.total += c.spent;
      totals.set(key, entry);
    }
  }
  return [...totals.values()]
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
    .slice(0, n)
    .map((e) => e.name);
}

export interface Change {
  category: string;
  previous: number;
  current: number;
}

/** Spending per category this month against last month, biggest rise first. */
export function monthOnMonth(previous: CategoryAmount[], current: CategoryAmount[]): Change[] {
  const names = new Map<string, string>();
  for (const c of [...current, ...previous]) {
    if (!names.has(c.category.toLowerCase())) names.set(c.category.toLowerCase(), c.category);
  }
  return [...names.values()]
    .map((category) => ({
      category,
      previous: amountOf(previous, category),
      current: amountOf(current, category),
    }))
    .sort(
      (a, b) =>
        b.current - b.previous - (a.current - a.previous) || a.category.localeCompare(b.category),
    );
}

function signedPounds(pence: number): string {
  if (pence === 0) return "±£0.00";
  return pence > 0 ? `+${pounds(pence)}` : pounds(pence);
}

export function MoneyTrends({ trend }: { trend: MonthTotals[] }) {
  const labels = trend.map((t) => shortMonth(t.month));
  const top = topCategories(trend);
  const categoryLines: Line[] = top.map((name, i) => ({
    key: name,
    name,
    color: LINE_COLORS[i % LINE_COLORS.length],
    values: trend.map((t) => amountOf(t.spending, name) / 100),
    dots: true,
  }));
  const rates = trend.map(savingsRate);
  // The window always has six months; the guard keeps a short one safe.
  const hasPair = trend.length >= 2;
  const current = trend[trend.length - 1];
  const previous = trend[trend.length - 2];
  const changes = hasPair ? monthOnMonth(previous.spending, current.spending) : [];
  const anything = trend.some((t) => t.income > 0 || t.spent > 0);

  if (!anything) return null;
  return (
    <div className="charts money__trends">
      <section className="card chart" aria-labelledby="chart-flows">
        <header className="chart__head">
          <h2 id="chart-flows" className="kicker">
            Income and spending
          </h2>
          <span className="muted">£, last {trend.length} months</span>
        </header>
        <div aria-hidden="true">
          <BarChart data={trend} label={(t) => shortMonth(t.month)} series={FLOWS} />
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
            {trend.map((t, i) => (
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

      <section className="card chart" aria-labelledby="chart-savings">
        <header className="chart__head">
          <h2 id="chart-savings" className="kicker">
            Savings rate
          </h2>
          <span className="muted">Share of income kept</span>
        </header>
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

      {categoryLines.length > 0 && (
        <section className="card chart" aria-labelledby="chart-categories">
          <header className="chart__head">
            <h2 id="chart-categories" className="kicker">
              Spending by category
            </h2>
            <span className="muted">£, top {categoryLines.length}</span>
          </header>
          <div aria-hidden="true">
            <LineChart labels={labels} lines={categoryLines} />
          </div>
          <ul className="bar-chart__legend" aria-hidden="true">
            {categoryLines.map((l) => (
              <li key={l.key}>
                <span className="bar-chart__swatch" style={{ background: l.color }} />
                {l.name}
              </li>
            ))}
          </ul>
        </section>
      )}

      {hasPair && (
        <section className="card chart" aria-labelledby="month-on-month">
          <header className="chart__head">
            <h2 id="month-on-month" className="kicker">
              Month on month
            </h2>
            <span className="muted">
              {shortMonth(previous.month)} → {shortMonth(current.month)}
            </span>
          </header>
          {changes.length === 0 ? (
            <p className="muted">No spending in either month.</p>
          ) : (
            <table className="table">
              <caption className="sr-only">Spending by category, last month and this month</caption>
              <thead>
                <tr>
                  <th scope="col">Category</th>
                  <th scope="col" className="table__num">
                    {shortMonth(previous.month)}
                  </th>
                  <th scope="col" className="table__num">
                    {shortMonth(current.month)}
                  </th>
                  <th scope="col" className="table__num">
                    Change
                  </th>
                </tr>
              </thead>
              <tbody>
                {changes.map((c) => {
                  const diff = c.current - c.previous;
                  return (
                    <tr key={c.category}>
                      <th scope="row">{c.category}</th>
                      <td className="table__num">{pounds(c.previous)}</td>
                      <td className="table__num">{pounds(c.current)}</td>
                      <td
                        className={`table__num${diff > 0 ? " money__up" : diff < 0 ? " money__in" : ""}`}
                      >
                        {signedPounds(diff)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {current.incomeBySource.length > 0 && (
            <>
              <h3 className="kicker">Income by source</h3>
              <ul className="rows">
                {current.incomeBySource.map((s) => (
                  <li key={s.category} className="row">
                    <span className="row__main row__title">{s.category}</span>
                    <span className="money__in">{pounds(s.spent)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </div>
  );
}
