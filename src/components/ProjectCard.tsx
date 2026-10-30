import type { Project } from "../api";

function stepSummary(p: Project): string {
  if (p.total === 0) return "No steps yet";
  if (p.current === null) {
    // Without a checklist the count comes from the note's front matter.
    return p.done >= p.total
      ? `All ${String(p.total)} steps done`
      : `${String(p.done)} of ${String(p.total)} steps done`;
  }
  return `Step ${String(p.current + 1)} of ${String(p.total)}`;
}

export function ProjectCard({ project: p }: { project: Project }) {
  const pct = p.total > 0 ? Math.min(100, Math.round((p.done / p.total) * 100)) : 0;
  const headingId = `project-${p.path}`;
  return (
    <section className="card project" aria-labelledby={headingId}>
      <div className="project__head">
        <h3 id={headingId} className="project__name">
          {p.name}
        </h3>
        <span className={`pill${p.active ? " pill--progress" : ""}`}>{p.status ?? "active"}</span>
        {p.updated && <span className="muted">Updated {p.updated}</span>}
      </div>

      <div
        className="progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={p.total}
        aria-valuenow={p.done}
        aria-label={`${String(p.done)} of ${String(p.total)} steps done`}
      >
        <span style={{ width: `${String(pct)}%` }} />
      </div>
      <p className="muted">{stepSummary(p)}</p>

      <div className="project__resume" role="group" aria-label={`Resume ${p.name}`}>
        <h4 className="kicker">Resume here</h4>
        {p.nextStep && (
          <p className="resume__next">
            <span className="pill pill--progress">Next</span> {p.nextStep}
          </p>
        )}
        <p className="muted">
          {p.lastLog
            ? `Last log: ${p.lastLog.date ? `${p.lastLog.date} · ` : ""}${p.lastLog.text}`
            : "No log entries yet"}
        </p>
      </div>

      {p.steps.length > 0 && (
        <ol className="project__steps" aria-label={`Steps for ${p.name}`}>
          {p.steps.map((s, i) => {
            const current = p.active && i === p.current;
            return (
              <li
                key={`${String(i)}-${s.text}`}
                className={`project__step${s.done ? " project__step--done" : ""}${current ? " breathing" : ""}`}
                aria-current={current ? "step" : undefined}
              >
                <span className="project__mark" aria-hidden="true">
                  {s.done ? "✓" : "○"}
                </span>
                <span className="project__step-text">{s.text}</span>
                <span className="sr-only">{s.done ? " (done)" : " (open)"}</span>
              </li>
            );
          })}
        </ol>
      )}

      {p.log.length > 0 && (
        <details className="project__log">
          <summary>Log ({p.log.length})</summary>
          <ul>
            {p.log.map((e, i) => (
              <li key={`${String(i)}-${e.text}`}>
                {e.date && (
                  <>
                    <time dateTime={e.date}>{e.date}</time>{" "}
                  </>
                )}
                {e.text}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
