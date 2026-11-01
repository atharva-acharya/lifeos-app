import type { ReactNode } from "react";
import "../styles/money-flows.css";

export function Tick() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      <path d="M2.5 6.2 4.9 8.6 9.5 3.6" />
    </svg>
  );
}

/** Where a guided flow is: numbered steps, done ones ticked. */
export function FlowSteps({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flow-steps" aria-label="Steps">
      {steps.map((name, i) => (
        <li
          key={name}
          className={`flow-steps__step${i < current ? " flow-steps__step--done" : ""}`}
          aria-current={i === current ? "step" : undefined}
        >
          <span className="flow-steps__dot">{i < current ? <Tick /> : i + 1}</span>
          {name}
        </li>
      ))}
    </ol>
  );
}

/** One step of a flow. It slides in from the side it was reached from. */
export function FlowPane({
  back = false,
  label,
  children,
}: {
  /** True when reached with Back, so it slides in from the left. */
  back?: boolean;
  label: string;
  children: ReactNode;
}) {
  return (
    <section className="flow__pane" data-dir={back ? "back" : undefined} aria-label={label}>
      {children}
    </section>
  );
}

/** The big amount at the top of a money flow, typed straight in. */
export function AmountEntry({
  value,
  onChange,
  label,
  focusOnOpen = false,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  /** Takes focus when its sheet opens: the amount is the first thing asked. */
  focusOnOpen?: boolean;
}) {
  return (
    <label className="amount-entry">
      <span className="amount-entry__currency" aria-hidden="true">
        £
      </span>
      <input
        inputMode="decimal"
        placeholder="0.00"
        autoComplete="off"
        aria-label={label}
        // eslint-disable-next-line jsx-a11y/no-autofocus -- a sheet opens on its first question
        autoFocus={focusOnOpen}
        value={value}
        onChange={(e) => {
          // Digits and one point, at most two decimals.
          const clean = e.target.value
            .replace(/[^\d.]/g, "")
            .replace(/(\..*)\./g, "$1")
            .replace(/(\.\d{2}).+/, "$1");
          onChange(clean);
        }}
      />
    </label>
  );
}

/** A colour for a person's avatar, the same every time for the same name. */
export function avatarColour(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `var(--avatar-${String((h % 6) + 1)})`;
}
