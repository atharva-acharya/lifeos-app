import { fromKeyboard, type TransitionOptions } from "../motion";
import { MAIN_ROUTES, SETTINGS_ROUTE, type Route, type RouteId } from "../routes";
import { NavIcon } from "./NavIcon";

interface SidebarProps {
  current: RouteId;
  /** `instant` is set when the keyboard chose the page, so it does not animate (M4). */
  onNavigate: (id: RouteId, options?: TransitionOptions) => void;
}

interface RailProps extends SidebarProps {
  /** Names shown beside the icons (Ctrl B); otherwise icons only. */
  expanded: boolean;
  onToggle: () => void;
}

function NavButton({ route, current, onNavigate }: { route: Route } & SidebarProps) {
  return (
    <li>
      <button
        type="button"
        className="nav__item"
        aria-current={route.id === current ? "page" : undefined}
        aria-label={route.label}
        onClick={(e) => {
          onNavigate(route.id, { instant: fromKeyboard(e) });
        }}
      >
        <NavIcon id={route.id} />
        <span className="nav__label">{route.label}</span>
        <span className="nav__tip" aria-hidden="true">
          {route.label}
          {route.id === "search" && <kbd>Ctrl K</kbd>}
        </span>
      </button>
    </li>
  );
}

/** A strip of page icons. Hovering an icon names it; Ctrl B shows every name. */
export function Sidebar({ current, onNavigate, expanded, onToggle }: RailProps) {
  return (
    <aside className="sidebar" data-expanded={expanded ? "" : undefined}>
      <nav aria-label="Main">
        <ul className="nav">
          {MAIN_ROUTES.map((route) => (
            <NavButton key={route.id} route={route} current={current} onNavigate={onNavigate} />
          ))}
        </ul>
      </nav>
      <ul className="nav nav--bottom" aria-label="App">
        <NavButton route={SETTINGS_ROUTE} current={current} onNavigate={onNavigate} />
        <li>
          <button
            type="button"
            className="nav__item nav__toggle"
            aria-expanded={expanded}
            aria-label={expanded ? "Hide page names" : "Show page names"}
            title="Ctrl B"
            onClick={onToggle}
          >
            <svg className="nav__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path
                d="m10 7 5 5-5 5"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.7}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="nav__label">Hide names</span>
          </button>
        </li>
      </ul>
    </aside>
  );
}
