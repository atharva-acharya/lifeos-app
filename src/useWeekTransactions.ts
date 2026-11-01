import { useEffect, useState } from "react";
import { getMoney, type MoneyRow } from "./api";

export interface WeekTransactions {
  /** True until every month has answered (or failed). */
  loading: boolean;
  /** Ledger rows of the months that loaded, each kept to its own month. */
  rows: MoneyRow[];
  /** Months (`YYYY-MM`) that could not be loaded. */
  failed: string[];
}

interface Loaded {
  key: string;
  rows: MoneyRow[];
  failed: string[];
}

const IDLE: WeekTransactions = { loading: false, rows: [], failed: [] };

/**
 * Transactions of `months` for the week range (ui-spec P7). A week can span
 * two months, and the page only loads the selected one, so each month is
 * fetched with `get_money`. A month that fails is reported in `failed`
 * instead of throwing, so the caller can say so quietly. Nothing is fetched
 * while `enabled` is false; a new `reload` value (e.g. the page's data after
 * a change) fetches again.
 */
export function useWeekTransactions(
  months: readonly string[],
  enabled: boolean,
  reload?: unknown,
): WeekTransactions {
  const key = months.join(",");
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    if (!enabled || key === "") return;
    let live = true;
    const list = key.split(",");
    void Promise.all(
      list.map((month) =>
        getMoney(month).then(
          (res) =>
            res.status === "ready"
              ? // The core answers for the month asked; keep to it all the same.
                { month, rows: res.money.transactions.filter((t) => t.date.startsWith(month)) }
              : { month, rows: null },
          () => ({ month, rows: null }),
        ),
      ),
    ).then((results) => {
      if (!live) return;
      setLoaded({
        key,
        rows: results.flatMap((r) => r.rows ?? []),
        failed: results.filter((r) => r.rows === null).map((r) => r.month),
      });
    });
    return () => {
      live = false;
    };
  }, [key, enabled, reload]);

  if (!enabled) return IDLE;
  // A reload of the same months keeps showing the last answer until the new one.
  if (loaded?.key !== key) return { loading: true, rows: [], failed: [] };
  return { loading: false, rows: loaded.rows, failed: loaded.failed };
}
