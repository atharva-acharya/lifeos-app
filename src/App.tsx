import { useEffect, useRef, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { JobsPage } from "./pages/JobsPage";
import { PlaceholderPage } from "./pages/PlaceholderPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TodayPage } from "./pages/TodayPage";
import { ALL_ROUTES, type RouteId } from "./routes";
import "./styles/global.css";
import "./styles/layout.css";

export default function App() {
  const [current, setCurrent] = useState<RouteId>("today");
  const mainRef = useRef<HTMLElement>(null);
  const route = ALL_ROUTES.find((r) => r.id === current) ?? ALL_ROUTES[0];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCurrent("search");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    mainRef.current?.focus();
  }, [current]);

  return (
    <div className="shell">
      <Sidebar current={current} onNavigate={setCurrent} />
      <main className="main" ref={mainRef} tabIndex={-1} aria-label={route.label}>
        {route.id === "today" ? (
          <TodayPage onNavigate={setCurrent} />
        ) : route.id === "jobs" ? (
          <JobsPage onNavigate={setCurrent} />
        ) : route.id === "settings" ? (
          <SettingsPage />
        ) : (
          <PlaceholderPage route={route} />
        )}
      </main>
    </div>
  );
}
