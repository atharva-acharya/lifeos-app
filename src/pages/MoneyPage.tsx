import { useCallback, useEffect, useRef, useState } from "react";
import {
  addTransaction,
  getMoney,
  localDate,
  onIndexUpdated,
  type BudgetLine,
  type Money,
  type MoneyResponse,
} from "../api";
import { Group, Metric } from "../components/Card";
import { EmptyHint } from "../components/EmptyHint";
import { ErrorState, loadError, type LoadError } from "../components/ErrorState";
import { MoneyImport } from "../components/MoneyImport";
import { ADD_FIELD_ID, MoneyQuickActions } from "../components/MoneyQuickActions";
import { MoneySplits } from "../components/MoneySplits";
import { MoneyTransactions } from "../components/MoneyTransactions";
import { ChangeLine, MoneyTrends } from "../components/MoneyTrends";
import { NotConnected } from "../components/NotConnected";
import { Skeleton, type SkeletonGroup } from "../components/Skeleton";
import { useMode } from "../mode";
import { compareMonths, pounds, toPence } from "../money";
import type { Navigate } from "../routes";

/** Metric row, quick actions, budgets beside quick add, then transactions. */
const SKELETON: SkeletonGroup[][] = [
  [{ cards: 4, columns: 4, height: 110, title: false }],
  [{ cards: 4, columns: 4, height: 40, title: false }],
  [
    { height: 240, weight: 3 },
    { height: 240, weight: 2 },
  ],
  [{ height: 200 }],
];

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + by, 1);
  return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const STATUS_TONE: Record<BudgetLine["status"], string> = {
  under: "done",
  near: "progress",
  over: "danger",
};

function Budgets({ budgets }: { budgets: BudgetLine[] }) {
  return (
    <Group title="Budgets" cardClassName="money__budgets">
      {budgets.length === 0 ? (
        <EmptyHint lead="No budgets yet.">
          Add <code>Money/Budgets.md</code> with <code>type: budgets</code> and a table with{" "}
          <code>Category</code> and <code>Monthly limit</code> columns.
        </EmptyHint>
      ) : (
        <ul className="budgets">
          {budgets.map((b) => {
            const pct = Math.min(100, Math.round((b.spent / b.limit) * 100));
            const tone = STATUS_TONE[b.status];
            return (
              <li key={b.category} className="budget">
                <div className="budget__head">
                  <span className="row__title">{b.category}</span>
                  <span className={`pill pill--${tone}`}>
                    {b.status === "over"
                      ? `${pounds(b.spent - b.limit)} over`
                      : `${pounds(b.limit - b.spent)} left`}
                  </span>
                </div>
                <div
                  className={`progress progress--${tone}`}
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={b.limit}
                  aria-valuenow={Math.min(b.spent, b.limit)}
                  aria-label={`${b.category}: ${pounds(b.spent)} of ${pounds(b.limit)}`}
                >
                  <span style={{ width: `${String(pct)}%` }} />
                </div>
                <span className="row__sub">
                  {pounds(b.spent)} of {pounds(b.limit)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Group>
  );
}

function QuickAdd({ categories, onAdded }: { categories: string[]; onAdded: () => void }) {
  const sample = useMode() === "sample";
  const [kind, setKind] = useState<"out" | "in">("out");
  const [date, setDate] = useState(localDate());
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [account, setAccount] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);

  const submit = (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (busy) return;
    const pence = toPence(amount);
    if (pence === null || pence === 0) {
      setMessage({ error: true, text: "Enter an amount like 12.50." });
      return;
    }
    setBusy(true);
    setMessage(null);
    addTransaction({
      date,
      description,
      category: category.trim() || null,
      amount: kind === "out" ? -pence : pence,
      account: account.trim() || null,
    })
      .then(() => {
        setMessage({ error: false, text: `Saved to Money/Ledger/${date.slice(0, 7)}.md.` });
        setDescription("");
        setAmount("");
        onAdded();
      })
      .catch((err: unknown) => {
        setMessage({ error: true, text: typeof err === "string" ? err : "Could not save." });
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <Group title="Quick add" cardClassName="card--stack">
      {sample && <p className="muted">Quick add is off while sample data is on.</p>}
      <form onSubmit={submit}>
        {/* Not disabled while saving, so focus stays on the Add button. */}
        <fieldset className="settings-group" disabled={sample}>
          <div className="tabs" role="radiogroup" aria-label="Money out or in">
            {(["out", "in"] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                data-kind={k}
                aria-checked={kind === k}
                tabIndex={kind === k ? 0 : -1}
                className="tabs__tab"
                onClick={() => {
                  setKind(k);
                }}
                onKeyDown={(e) => {
                  // Two options: any arrow key moves to the other one.
                  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
                    e.preventDefault();
                    const next = k === "out" ? "in" : "out";
                    setKind(next);
                    e.currentTarget.parentElement
                      ?.querySelector<HTMLElement>(`[data-kind="${next}"]`)
                      ?.focus();
                  }
                }}
              >
                {k === "out" ? "Money out" : "Money in"}
              </button>
            ))}
          </div>
          <div className="form">
            <label>
              <span className="kicker">Date</span>
              <input
                type="date"
                required
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                }}
              />
            </label>
            <label>
              <span className="kicker">Description</span>
              <input
                id={ADD_FIELD_ID}
                required
                maxLength={200}
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                }}
              />
            </label>
            <label>
              <span className="kicker">Amount (£)</span>
              <input
                required
                inputMode="decimal"
                placeholder="12.50"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                }}
              />
            </label>
            <label>
              <span className="kicker">Category</span>
              <input
                list="money-categories"
                maxLength={60}
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value);
                }}
              />
              <datalist id="money-categories">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </label>
            <label>
              <span className="kicker">Account (optional)</span>
              <input
                maxLength={60}
                value={account}
                onChange={(e) => {
                  setAccount(e.target.value);
                }}
              />
            </label>
            <div className="form__actions">
              <button type="submit" className="button button--primary">
                {busy ? "Saving…" : "Add"}
              </button>
            </div>
          </div>
        </fieldset>
      </form>
      {message && (
        <p
          className={message.error ? "setting__error" : "muted"}
          role={message.error ? "alert" : "status"}
        >
          {message.text}
        </p>
      )}
    </Group>
  );
}

function Dashboard({ money, onAdded }: { money: Money; onAdded: () => void }) {
  const sample = useMode() === "sample";
  const net = money.income - money.spent;
  const rate = money.income > 0 ? Math.round((net / money.income) * 100) : null;
  // "vs previous period" for the metric row; the trend ends with this month.
  const vs =
    money.trend[money.trend.length - 1]?.month === money.month ? compareMonths(money.trend) : null;
  return (
    <div className="page money">
      {!money.hasLedger && !money.hasBudgets && (
        <section className="card">
          <EmptyHint lead="No money notes yet.">
            Quick add creates <code>Money/Ledger/YYYY-MM.md</code> for you. Budgets live in{" "}
            <code>Money/Budgets.md</code>.
          </EmptyHint>
        </section>
      )}
      <div className="grid grid--4">
        <Metric
          label="Spent"
          color="var(--cat-money)"
          value={pounds(money.spent)}
          detail={vs && <ChangeLine diff={vs.spent} previous={vs.previous} upIsGood={false} />}
        />
        <Metric
          label="Income"
          color="var(--cat-money)"
          value={pounds(money.income)}
          detail={vs && <ChangeLine diff={vs.income} previous={vs.previous} upIsGood />}
        />
        <Metric
          label="Net"
          color="var(--cat-money)"
          value={pounds(net)}
          tone={net < 0 ? "danger" : undefined}
          detail={vs && <ChangeLine diff={vs.net} previous={vs.previous} upIsGood />}
        />
        <Metric
          label="Savings rate"
          color="var(--cat-money)"
          value={rate === null ? "—" : String(rate)}
          unit={rate === null ? undefined : "%"}
          detail={
            vs &&
            vs.rate !== null && (
              <ChangeLine diff={vs.rate} previous={vs.previous} unit="points" upIsGood />
            )
          }
        />
      </div>

      <MoneyQuickActions friends={money.friends} />

      <div className="grid grid--wide-left">
        <Budgets budgets={money.budgets} />
        <QuickAdd categories={money.knownCategories} onAdded={onAdded} />
      </div>

      <MoneyTransactions
        transactions={money.transactions}
        monthLabel={monthLabel(money.month)}
        categories={money.knownCategories}
        onChanged={onAdded}
      />

      <MoneySplits
        friends={money.friends}
        recent={money.splits}
        readOnly={sample}
        onChanged={onAdded}
      />

      <MoneyTrends trend={money.trend} />

      {!sample && <MoneyImport onImported={onAdded} />}

      {money.parseErrors > 0 && (
        <p className="notice" role="status">
          {money.parseErrors} money note{money.parseErrors === 1 ? "" : "s"} could not be read.
          Check their fields.
        </p>
      )}
    </div>
  );
}

export function MoneyPage({ onNavigate }: { onNavigate: Navigate }) {
  const [month, setMonth] = useState(() => localDate().slice(0, 7));
  // The month the shown response belongs to; it trails `month` while the next one loads.
  const [loaded, setLoaded] = useState<{ month: string; response: MoneyResponse } | null>(null);
  const [error, setError] = useState<LoadError | null>(null);
  // Answers for a month the page has already moved on from are dropped.
  const wanted = useRef(month);
  useEffect(() => {
    wanted.current = month;
  }, [month]);

  const load = useCallback(() => {
    getMoney(month)
      .then((r) => {
        if (wanted.current !== month) return;
        setLoaded({ month, response: r });
        setError(null);
      })
      .catch((err: unknown) => {
        if (wanted.current !== month) return;
        setError(loadError(err));
      });
  }, [month]);

  const retry = useCallback(() => {
    setError(null);
    load();
  }, [load]);

  useEffect(() => {
    load();
    let unsubscribe: (() => void) | undefined;
    let active = true;
    onIndexUpdated(load)
      .then((u) => {
        if (active) unsubscribe = u;
        else u();
      })
      .catch(() => undefined);
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [load]);

  const response = loaded?.response ?? null;
  // Changing month keeps the last month on screen, dimmed, instead of a skeleton.
  // If that month then fails to load, only the error shows, not the old month.
  const stale = loaded !== null && loaded.month !== month;
  const busy = stale && error === null;

  return (
    <>
      <header className="page-header">
        <p className="kicker">Budget</p>
        <h1 className="page-title">Money</h1>
        <div className="month-nav">
          <button
            type="button"
            className="button button--quiet"
            aria-label="Previous month"
            onClick={() => {
              setMonth((m) => shiftMonth(m, -1));
            }}
          >
            ‹
          </button>
          <span className="month-nav__label" aria-live="polite">
            {monthLabel(month)}
          </span>
          <button
            type="button"
            className="button button--quiet"
            aria-label="Next month"
            onClick={() => {
              setMonth((m) => shiftMonth(m, 1));
            }}
          >
            ›
          </button>
        </div>
      </header>
      {error && <ErrorState title="Could not load money." detail={error.detail} onRetry={retry} />}
      {response === null && error === null && <Skeleton label="money" layout={SKELETON} />}
      {response !== null && (!stale || busy) && (
        <div className={busy ? "page-data page-data--busy" : "page-data"} aria-busy={busy}>
          {response.status === "noVault" && (
            <NotConnected onNavigate={onNavigate}>
              Choose your Life OS vault folder to see your spending and budgets.
            </NotConnected>
          )}
          {response.status === "ready" && <Dashboard money={response.money} onAdded={load} />}
        </div>
      )}
    </>
  );
}
