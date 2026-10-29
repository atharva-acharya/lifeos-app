import { MAIN_ROUTES, SETTINGS_ROUTE, type Route, type RouteId } from "../routes";
import { NavIcon } from "./NavIcon";

interface SidebarProps {
  current: RouteId;
  onNavigate: (id: RouteId) => void;
}

function NavButton({ route, current, onNavigate }: { route: Route } & SidebarProps) {
  return (
    <li>
      <button
        type="button"
        className="nav__item"
        aria-current={route.id === current ? "page" : undefined}
        onClick={() => {
          onNavigate(route.id);
        }}
      >
        <NavIcon id={route.id} />
        {route.label}
        {route.id === "search" && <span className="nav__hint">Ctrl K</span>}
      </button>
    </li>
  );
}

export function Sidebar({ current, onNavigate }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand__mark" aria-hidden="true" />
        Life OS
      </div>
      <nav aria-label="Main">
        <ul className="nav">
          {MAIN_ROUTES.map((route) => (
            <NavButton key={route.id} route={route} current={current} onNavigate={onNavigate} />
          ))}
        </ul>
      </nav>
      <ul className="nav nav--bottom" aria-label="App">
        <NavButton route={SETTINGS_ROUTE} current={current} onNavigate={onNavigate} />
      </ul>
    </aside>
  );
}
