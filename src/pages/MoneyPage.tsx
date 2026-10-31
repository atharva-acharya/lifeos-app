import { useCallback, useEffect, useState } from "react";
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
import { MoneyImport } from "../components/MoneyImport";
import { ADD_FIELD_ID, MoneyQuickActions } from "../components/MoneyQuickActions";
import { MoneySplits } from "../components/MoneySplits";
import { MoneyTrends } from "../components/MoneyTrends";
import { NotConnected } from "../components/NotConnected";
import { useMode } from "../mode";
import { pounds, toPence } from "../money";
import type { Navigate } from "../routes";

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
        <Metric label="Spent" color="var(--cat-money)" value={pounds(money.spent)} />
        <Metric label="Income" color="var(--cat-money)" value={pounds(money.income)} />
        <Metric
          label="Net"
          color="var(--cat-money)"
          value={pounds(net)}
          tone={net < 0 ? "danger" : undefined}
        />
        <Metric
          label="Savings rate"
          color="var(--cat-money)"
          value={rate === null ? "—" : String(rate)}
          unit={rate === null ? undefined : "%"}
        />
      </div>

      <MoneyQuickActions friends={money.friends} />

      <div className="grid grid--wide-left">
        <Budgets budgets={money.budgets} />
        <QuickAdd categories={money.knownCategories} onAdded={onAdded} />
      </div>

      <Group title="Transactions" cardClassName="card--flush">
        {money.transactions.length === 0 ? (
          <p className="muted">Nothing recorded in {monthLabel(money.month)}.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Description</th>
                <th scope="col">Category</th>
                <th scope="col">Account</th>
                <th scope="col" className="table__num">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {money.transactions.map((t, i) => (
                <tr key={`${t.date}-${String(i)}`}>
                  <td>{t.date}</td>
                  <td>{t.description}</td>
                  <td>{t.category ?? "—"}</td>
                  <td>{t.account ?? "—"}</td>
                  <td className={`table__num${t.amount > 0 ? " money__in" : ""}`}>
                    {t.amount > 0 ? `+${pounds(t.amount)}` : pounds(t.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Group>

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
  const [response, setResponse] = useState<MoneyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    getMoney(month)
      .then((r) => {
        setResponse(r);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(typeof err === "string" ? err : "Could not load money.");
      });
  }, [month]);

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
      {error && (
        <p className="setting__error" role="alert">
          {error}
        </p>
      )}
      {response?.status === "noVault" && (
        <NotConnected onNavigate={onNavigate}>
          Choose your Life OS vault folder to see your spending and budgets.
        </NotConnected>
      )}
      {response?.status === "ready" && <Dashboard money={response.money} onAdded={load} />}
    </>
  );
}
