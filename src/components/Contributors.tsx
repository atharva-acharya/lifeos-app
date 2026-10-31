import { comparison, direction, type Contributor } from "../healthStats";
import "../styles/contributors.css";

const MARK = { up: "↑", down: "↓", level: "=" } as const;
const MARK_NAME = { up: "Up", down: "Down", level: "Level" } as const;

/**
 * The inputs behind a ring or score (ui-spec P4): each with its value and an
 * up, down or level marker against the owner's own 30-day average. A list
 * row per input (C3); a missing value reads "—" (T8).
 */
export function Contributors({ items, lead }: { items: Contributor[]; lead?: string }) {
  return (
    <>
      {lead && <p className="muted contributors__lead">{lead}</p>}
      <ul className="list contributors">
        {items.map((c) => {
          const dir = direction(c.value, c.average);
          const missing = c.value === null || !Number.isFinite(c.value);
          return (
            <li key={c.key} className="list__row">
              <span className="list__main">
                <span className="row__title">{c.name}</span>
                <span className="row__sub">{comparison(c)}</span>
              </span>
              <span className="contributors__value">
                {missing || c.value === null ? "—" : c.format(c.value)}
                {dir !== null && (
                  <span className="contributors__mark" data-direction={dir}>
                    <span aria-hidden="true">{MARK[dir]}</span>
                    <span className="sr-only">{MARK_NAME[dir]}</span>
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </>
  );
}
