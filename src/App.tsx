import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { getSettings } from "./api";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { PageBar, usePageBar } from "./components/PageBar";
import { SampleBanner } from "./components/SampleBanner";
import { Sidebar } from "./components/Sidebar";
import { TitleBar } from "./components/TitleBar";
import { UpdateBanner } from "./components/UpdateBanner";
import type { GuideId } from "./guides";
import { loadMode, useMode } from "./mode";
import { FitnessPage } from "./pages/FitnessPage";
import { HealthPage } from "./pages/HealthPage";
import { JobsPage } from "./pages/JobsPage";
import { MoneyPage } from "./pages/MoneyPage";
import { PlaceholderPage } from "./pages/PlaceholderPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TodayPage } from "./pages/TodayPage";
import { WelcomePage } from "./pages/WelcomePage";
import { ALL_ROUTES, type RouteId } from "./routes";
import "./styles/global.css";
import "./styles/layout.css";
import "./styles/cards.css";
import "./styles/motion.css";
import { withTransition, type TransitionOptions } from "./motion";
import { applyStoredTransparency } from "./appearance";
import { useScrolled } from "./useScrolled";

// Before the first paint, so the sidebar never flashes as glass when the
// owner has turned on "Reduce transparency".
applyStoredTransparency();

export default function App() {
  const mode = useMode();
  const [current, setCurrent] = useState<RouteId>("today");
  const [guide, setGuide] = useState<GuideId | null>(null);
  // Known after the first read of settings and mode; until then nothing is drawn.
  const [hasVault, setHasVault] = useState<boolean | null>(null);
  // "Skip for now" lasts until the app restarts; the welcome screen returns while no vault is set.
  const [skipped, setSkipped] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const toggleRail = useCallback(() => {
    setRailOpen((open) => !open);
  }, []);
  const mainRef = useRef<HTMLElement | null>(null);
  const [mainEl, setMainEl] = useState<HTMLElement | null>(null);
  const setMain = useCallback((el: HTMLElement | null) => {
    mainRef.current = el;
    setMainEl(el);
  }, []);
  const route = ALL_ROUTES.find((r) => r.id === current) ?? ALL_ROUTES[0];

  const go = useCallback((id: RouteId, to?: GuideId, options?: TransitionOptions) => {
    withTransition(() => {
      setCurrent(id);
      setGuide(id === "settings" ? (to ?? null) : null);
    }, options);
  }, []);
  // Pages navigate with the mouse transition; the sidebar and Ctrl K say
  // when the keyboard started the change (M4).
  const navigate = useCallback(
    (id: RouteId, to?: GuideId) => {
      go(id, to);
    },
    [go],
  );
  const navigateFromSidebar = useCallback(
    (id: RouteId, options?: TransitionOptions) => {
      go(id, undefined, options);
    },
    [go],
  );

  useEffect(() => {
    let active = true;
    Promise.all([getSettings(), loadMode()])
      .then(([s]) => {
        if (active) setHasVault(s.vaultPath !== null);
      })
      // If settings cannot be read the pages report it; do not trap the owner on Welcome.
      .catch(() => {
        if (active) setHasVault(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        go("search", undefined, { instant: true });
      } else if (e.ctrlKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleRail();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [go, toggleRail]);

  useEffect(() => {
    mainRef.current?.focus();
  }, [current]);

  useScrolled(mainEl, current);
  const pageBar = usePageBar(mainEl, current);

  // Every state keeps the app's own top bar: without it the window could not
  // be moved, minimised or closed.
  if (hasVault === null)
    return (
      <div className="shell shell--bare">
        <TitleBar />
        <div className="boot" aria-busy="true" />
      </div>
    );

  if (!hasVault && mode === "real" && !skipped) {
    return (
      <div className="shell shell--bare">
        <TitleBar />
        <WelcomePage
          onChosen={() => {
            setHasVault(true);
            setCurrent("today");
          }}
          onSkip={() => {
            setSkipped(true);
          }}
        />
      </div>
    );
  }

  return (
    <div className="shell">
      <TitleBar />
      <Sidebar
        current={current}
        onNavigate={navigateFromSidebar}
        expanded={railOpen}
        onToggle={toggleRail}
      />
      <main
        className="main"
        ref={setMain}
        tabIndex={-1}
        aria-label={route.label}
        data-page-bar={pageBar ? "" : undefined}
      >
        <PageBar title={route.label} visible={pageBar} />
        {mode === "sample" && (
          <SampleBanner
            onLeft={(vaultPath) => {
              setHasVault(vaultPath !== null);
              setSkipped(false);
              setCurrent("today");
            }}
          />
        )}
        <UpdateBanner />
        {/* Switching between sample and real data remounts the page so it reloads. */}
        <Fragment key={mode}>
          <ErrorBoundary resetKey={route.id}>
            {route.id === "today" ? (
              <TodayPage onNavigate={navigate} />
            ) : route.id === "jobs" ? (
              <JobsPage onNavigate={navigate} />
            ) : route.id === "fitness" ? (
              <FitnessPage onNavigate={navigate} />
            ) : route.id === "health" ? (
              <HealthPage onNavigate={navigate} />
            ) : route.id === "money" ? (
              <MoneyPage onNavigate={navigate} />
            ) : route.id === "projects" ? (
              <ProjectsPage onNavigate={navigate} />
            ) : route.id === "settings" ? (
              <SettingsPage openGuide={guide} />
            ) : (
              <PlaceholderPage route={route} />
            )}
          </ErrorBoundary>
        </Fragment>
      </main>
    </div>
  );
}
