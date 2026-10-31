import { useId } from "react";
import { localDate, type MoneyRow } from "../api";
import { pounds } from "../money";
import { Group } from "./Card";
import "../styles/money-transactions.css";

function parseDay(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** "Today", "Yesterday", otherwise e.g. "Tue 27 Oct". */
export function dayLabel(date: string, today: string): string {
  if (date === today) return "Today";
  const yesterday = parseDay(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date === localDate(yesterday)) return "Yesterday";
  const day = parseDay(date);
  if (Number.isNaN(day.getTime())) return date;
  return day.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

/** Pounds with a sign: "+£12.00", "-£3.20", and zero as "£0.00". */
export function signed(pence: number): string {
  return pence > 0 ? `+${pounds(pence)}` : pounds(pence);
}

export interface Day {
  date: string;
  net: number;
  rows: MoneyRow[];
}

/** Transactions by date, newest day first; rows keep their order within a day. */
export function groupByDay(transactions: MoneyRow[]): Day[] {
  const days = new Map<string, Day>();
  for (const t of transactions) {
    let day = days.get(t.date);
    if (!day) {
      day = { date: t.date, net: 0, rows: [] };
      days.set(t.date, day);
    }
    day.net += t.amount;
    day.rows.push(t);
  }
  return [...days.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** A value, or a dash read as "none" when it is missing (spec T8). */
function OrDash({ value }: { value: string | null }) {
  if (value) return <>{value}</>;
  return (
    <>
      <span aria-hidden="true">—</span>
      <span className="sr-only">none</span>
    </>
  );
}

function DayGroup({ day, today }: { day: Day; today: string }) {
  const id = useId();
  const label = dayLabel(day.date, today);
  return (
    <li className="money-tx__day">
      <section aria-labelledby={id}>
        <div className="money-tx__head">
          <h3 id={id} className="money-tx__date">
            {label}
          </h3>
          <p className="money-tx__net">
            <span className="sr-only">Net for the day </span>
            {signed(day.net)}
          </p>
        </div>
        <ul className="money-tx__rows" aria-label={`Transactions on ${label}`}>
          {day.rows.map((t, i) => (
            <li key={i} className="money-tx__row">
              <div className="money-tx__main">
                <span className="money-tx__title">{t.description}</span>
                <span className="money-tx__sub">
                  <span className="sr-only">Category </span>
                  <OrDash value={t.category} />
                  <span aria-hidden="true"> · </span>
                  <span className="sr-only">, account </span>
                  <OrDash value={t.account} />
                </span>
              </div>
              <span className={`money-tx__amount${t.amount > 0 ? " money-tx__amount--in" : ""}`}>
                <span className="sr-only">Amount </span>
                {signed(t.amount)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </li>
  );
}

/**
 * The month's transactions as a list grouped by day (spec P6, C3). Each day
 * has a sticky header with its date and net.
 */
export function MoneyTransactions({
  transactions,
  monthLabel,
  today = localDate(),
}: {
  transactions: MoneyRow[];
  /** e.g. "October 2026", for the empty state. */
  monthLabel: string;
  /** YYYY-MM-DD; defaults to the local date. */
  today?: string;
}) {
  const days = groupByDay(transactions);
  return (
    <Group title="Transactions" cardClassName="card--flush money-tx">
      {days.length === 0 ? (
        <p className="muted">Nothing recorded in {monthLabel}.</p>
      ) : (
        <ul className="money-tx__days">
          {days.map((day) => (
            <DayGroup key={day.date} day={day} today={today} />
          ))}
        </ul>
      )}
    </Group>
  );
}
