import { useCallback, useEffect, useRef, useState } from "react";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Sidebar } from "./components/Sidebar";
import { UpdateBanner } from "./components/UpdateBanner";
import { FitnessPage } from "./pages/FitnessPage";
import { JobsPage } from "./pages/JobsPage";
import { PlaceholderPage } from "./pages/PlaceholderPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TodayPage } from "./pages/TodayPage";
import { ALL_ROUTES, type RouteId } from "./routes";
import "./styles/global.css";
import "./styles/layout.css";
import "./styles/motion.css";
import { withTransition } from "./motion";

export default function App() {
  const [current, setCurrent] = useState<RouteId>("today");
  const mainRef = useRef<HTMLElement>(null);
  const route = ALL_ROUTES.find((r) => r.id === current) ?? ALL_ROUTES[0];
  const navigate = useCallback((id: RouteId) => {
    withTransition(() => {
      setCurrent(id);
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        navigate("search");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [navigate]);

  useEffect(() => {
    mainRef.current?.focus();
  }, [current]);

  return (
    <div className="shell">
      <Sidebar current={current} onNavigate={navigate} />
      <main className="main" ref={mainRef} tabIndex={-1} aria-label={route.label}>
        <UpdateBanner />
        <ErrorBoundary resetKey={route.id}>
          {route.id === "today" ? (
            <TodayPage onNavigate={navigate} />
          ) : route.id === "jobs" ? (
            <JobsPage onNavigate={navigate} />
          ) : route.id === "fitness" ? (
            <FitnessPage onNavigate={navigate} />
          ) : route.id === "settings" ? (
            <SettingsPage />
          ) : (
            <PlaceholderPage route={route} />
          )}
        </ErrorBoundary>
      </main>
    </div>
  );
}
