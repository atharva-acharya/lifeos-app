import "../styles/error-state.css";

/**
 * A page that could not load (ui-spec C7): what happened in plain words, the
 * detail the app reported, and a way to try again.
 */
export function ErrorState({
  title,
  detail,
  onRetry,
}: {
  /** Plain words, e.g. "Fitness could not load." */
  title: string;
  /** The error the app reported, shown under the title. */
  detail?: string | null;
  onRetry: () => void;
}) {
  return (
    <section className="card error-state" role="alert">
      <p className="error-state__title">{title}</p>
      {detail && detail !== title && <p className="error-state__detail">{detail}</p>}
      <button type="button" className="button" onClick={onRetry}>
        Try again
      </button>
    </section>
  );
}

/**
 * A failed page load: `detail` is what the core said (Tauri rejects with a
 * string), or null when it gave nothing readable.
 */
export interface LoadError {
  detail: string | null;
}

export function loadError(err: unknown): LoadError {
  return { detail: typeof err === "string" ? err : null };
}
