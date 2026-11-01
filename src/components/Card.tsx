import { useId, type ReactNode } from "react";
import { useCountUp } from "../useCountUp";

/**
 * A titled group in the style of Apple Health: the heading sits above the
 * card, not inside it (docs/design-rules.md §3). `bare` puts the children
 * straight under the heading, for a grid of cards.
 */
export function Group({
  title,
  action,
  children,
  className,
  cardClassName,
  bare = false,
  level = 2,
}: {
  title: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  cardClassName?: string;
  bare?: boolean;
  level?: 2 | 3;
}) {
  const id = useId();
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <section className={`group${className ? ` ${className}` : ""}`} aria-labelledby={id}>
      <div className="group__head">
        <Heading id={id} className="group__title">
          {title}
        </Heading>
        {action}
      </div>
      {bare ? (
        children
      ) : (
        <div className={`card${cardClassName ? ` ${cardClassName}` : ""}`}>{children}</div>
      )}
    </section>
  );
}

function Chevron() {
  return (
    <svg className="metric__chevron" viewBox="0 0 8 13" width="8" height="13" aria-hidden="true">
      <path
        d="M1.5 1.5 6.5 6.5 1.5 11.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The top row of a metric card: a small coloured label on the left, and on
 * the right an optional note and a chevron when the card opens a page.
 */
export function MetricHead({
  label,
  color,
  aside,
  onOpen,
  openLabel,
  as: Tag = "p",
  id,
}: {
  label: ReactNode;
  color: string;
  aside?: ReactNode;
  onOpen?: () => void;
  /** Accessible name of the open button, e.g. "Open Jobs". */
  openLabel?: string;
  as?: "p" | "h2" | "h3";
  id?: string;
}) {
  return (
    <div className="metric__head">
      <Tag id={id} className="metric__label" style={{ color }}>
        {label}
      </Tag>
      {(aside !== undefined || onOpen) && (
        <span className="metric__aside">
          {aside}
          {onOpen && (
            <button type="button" className="metric__open" aria-label={openLabel} onClick={onOpen}>
              <Chevron />
            </button>
          )}
        </span>
      )}
    </div>
  );
}

/** A big number with its unit set smaller in secondary grey. */
export function Value({
  value,
  unit,
  tone,
  srPrefix,
}: {
  value: ReactNode;
  unit?: string;
  tone?: "danger";
  /** Read before the value by screen readers only, e.g. "Latest". */
  srPrefix?: string;
}) {
  return (
    <p className={`metric__value${tone ? ` metric__value--${tone}` : ""}`}>
      {srPrefix && <span className="sr-only">{srPrefix} </span>}
      {value}
      {unit && <span className="metric__unit"> {unit}</span>}
    </p>
  );
}

/** The default count format: a whole number. */
function whole(n: number): string {
  return String(Math.round(n));
}

/** A number that counts to each new value (ui-spec M9). */
function CountedValue({ count, format }: { count: number; format: (n: number) => string }) {
  return <>{format(useCountUp(count))}</>;
}

/**
 * Apple Health's summary tile: coloured label and chevron at the top, the
 * big number bottom-left, unit in grey, optional detail under it.
 */
export function Metric({
  label,
  color,
  value,
  unit,
  detail,
  aside,
  onOpen,
  openLabel,
  tone,
  count,
  format = whole,
}: {
  label: string;
  color: string;
  /** What to show; ignored when `count` is given. */
  value?: ReactNode;
  unit?: string;
  detail?: ReactNode;
  aside?: ReactNode;
  onOpen?: () => void;
  openLabel?: string;
  tone?: "danger";
  /** A number to show instead of `value`; it counts to each new value. */
  count?: number;
  /** Formats `count` and each step of the count; whole numbers by default. */
  format?: (n: number) => string;
}) {
  return (
    <section className={`card metric${onOpen ? " metric--link" : ""}`} aria-label={label}>
      <MetricHead label={label} color={color} aside={aside} onOpen={onOpen} openLabel={openLabel} />
      <div className="metric__body">
        <Value
          value={count === undefined ? value : <CountedValue count={count} format={format} />}
          unit={unit}
          tone={tone}
        />
        {detail && <div className="metric__detail">{detail}</div>}
      </div>
    </section>
  );
}

/** A card's own title row: the title inside the card, an action on the right. */
export function CardHead({ id, title, action }: { id: string; title: string; action?: ReactNode }) {
  return (
    <div className="card__head">
      <h2 id={id} className="card__title">
        {title}
      </h2>
      {action}
    </div>
  );
}

export function MoreLink({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" className="link-button card__action" onClick={onClick}>
      {children}
      <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
        <path d="M4.5 2.5 8 6l-3.5 3.5" />
      </svg>
    </button>
  );
}
