import type { Route } from "../routes";

export function PlaceholderPage({ route }: { route: Route }) {
  return (
    <>
      <header className="page-header">
        <p className="kicker">{route.kicker}</p>
        <h1 className="page-title">{route.label}</h1>
      </header>
      <section className="card placeholder breathing" aria-label={`${route.label} status`}>
        <span className="pill pill--pending">Phase {route.phase}</span>
        <p>{route.summary}</p>
      </section>
    </>
  );
}
