import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  getMoney,
  localDate,
  onIndexUpdated,
  type BudgetLine,
  type Money,
  type MoneyResponse,
} from "../api";
import { CardHead, Metric } from "../components/Card";
import { EmptyHint } from "../components/EmptyHint";
import { ErrorState, loadError, type LoadError } from "../components/ErrorState";
import { MoneyImport } from "../components/MoneyImport";
import { MoneyAddSheet } from "../components/MoneyAddSheet";
import {
  BUDGETS_TITLE_ID,
  MoneyQuickActions,
  type SheetAction,
} from "../components/MoneyQuickActions";
import { MoneySplitFlow } from "../components/MoneySplitFlow";
import { MoneySplits } from "../components/MoneySplits";
import { MoneyTransactions } from "../components/MoneyTransactions";
import { ChangeLine, MoneyTrends } from "../components/MoneyTrends";
import { NotConnected } from "../components/NotConnected";
import { Skeleton, type SkeletonGroup } from "../components/Skeleton";
import { Toast, type ToastMessage } from "../components/Toast";
import { useMode } from "../mode";
import { compareMonths, pounds } from "../money";
import type { Navigate } from "../routes";
import "../styles/money-page.css";

/** Metric row, then analytics, transactions, and budgets with splits. */
const SKELETON: SkeletonGroup[][] = [
  [{ cards: 4, columns: 4, height: 112, title: false }],
  [
    { height: 560, weight: 5, title: false },
    { height: 560, weight: 4, title: false },
    { height: 560, weight: 3, title: false },
  ],
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
    <section className="card money__budgets" aria-labelledby={BUDGETS_TITLE_ID}>
      <CardHead id={BUDGETS_TITLE_ID} title="Budgets" />
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
                  {b.status === "over" ? (
                    <span className="pill pill--danger">{pounds(b.spent - b.limit)} over</span>
                  ) : (
                    <span className={`budget__left budget__left--${tone}`}>
                      {pounds(b.limit - b.spent)} left of {pounds(b.limit)}
                    </span>
                  )}
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
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Dashboard({
  money,
  onAdded,
  actionsSlot,
}: {
  money: Money;
  onAdded: () => void;
  /** Where the quick actions go: the page header, beside the title. */
  actionsSlot: HTMLElement | null;
}) {
  const sample = useMode() === "sample";
  const [sheet, setSheet] = useState<SheetAction | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const nextToast = useRef(0);
  const net = money.income - money.spent;
  const rate = money.income > 0 ? Math.round((net / money.income) * 100) : null;
  // "vs previous period" for the metric row; the trend ends with this month.
  const vs =
    money.trend[money.trend.length - 1]?.month === money.month ? compareMonths(money.trend) : null;

  const say = (text: string) => {
    nextToast.current += 1;
    setToast({ id: nextToast.current, text });
  };
  const close = () => {
    setSheet(null);
  };

  return (
    <div className="page page--fit money">
      {actionsSlot &&
        createPortal(
          <MoneyQuickActions
            friends={money.friends}
            onOpen={(action, from) => {
              trigger.current = from;
              setSheet(action);
            }}
          />,
          actionsSlot,
        )}
      {!money.hasLedger && !money.hasBudgets && (
        <section className="card money__empty">
          <EmptyHint lead="No money notes yet.">
            Add creates <code>Money/Ledger/YYYY-MM.md</code> for you. Budgets live in{" "}
            <code>Money/Budgets.md</code>.
          </EmptyHint>
        </section>
      )}
      <div className="money__grid">
        <div className="money__metrics">
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

        <MoneyTrends trend={money.trend} />

        <MoneyTransactions
          transactions={money.transactions}
          monthLabel={monthLabel(money.month)}
          categories={money.knownCategories}
          onChanged={onAdded}
        />

        <div className="money__side">
          <Budgets budgets={money.budgets} />
          <MoneySplits
            friends={money.friends}
            recent={money.splits}
            readOnly={sample}
            onChanged={onAdded}
          />
        </div>
      </div>

      {money.parseErrors > 0 && (
        <p className="notice" role="status">
          {money.parseErrors} money note{money.parseErrors === 1 ? "" : "s"} could not be read.
          Check their fields.
        </p>
      )}

      <MoneyAddSheet
        open={sheet === "add"}
        onClose={close}
        trigger={trigger}
        categories={money.knownCategories}
        disabledReason={sample ? "Adding is off while sample data is on." : null}
        onAdded={(a) => {
          onAdded();
          const sign = a.amount < 0 ? "−" : "+";
          say(`Added ${sign}${pounds(Math.abs(a.amount))}${a.category ? ` · ${a.category}` : ""}`);
        }}
      />
      <MoneySplitFlow
        open={sheet === "split"}
        onClose={close}
        trigger={trigger}
        known={money.friends.map((f) => f.friend)}
        onSaved={(text) => {
          onAdded();
          say(text);
        }}
      />
      {!sample && (
        <MoneyImport
          open={sheet === "import"}
          onClose={close}
          trigger={trigger}
          onImported={onAdded}
        />
      )}
      <Toast
        toast={toast}
        onDismiss={() => {
          setToast(null);
        }}
      />
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

  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null);
  const response = loaded?.response ?? null;
  // Changing month keeps the last month on screen, dimmed, instead of a skeleton.
  // If that month then fails to load, only the error shows, not the old month.
  const stale = loaded !== null && loaded.month !== month;
  const busy = stale && error === null;

  return (
    <>
      <header className="page-header page-header--row">
        <div>
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
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                <path
                  d="M10 3.5 5.5 8l4.5 4.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
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
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                <path
                  d="M6 3.5 10.5 8 6 12.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        </div>
        {/* The quick actions are drawn here once the month has loaded. */}
        <div className="page-header__actions" ref={setActionsSlot} />
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
          {response.status === "ready" && (
            <Dashboard money={response.money} onAdded={load} actionsSlot={actionsSlot} />
          )}
        </div>
      )}
    </>
  );
}
