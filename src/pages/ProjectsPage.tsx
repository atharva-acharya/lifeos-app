import { useCallback, useEffect, useState } from "react";
import { getProjects, onIndexUpdated, type ProjectsResponse, type Projects } from "../api";
import { ProjectCard } from "../components/ProjectCard";
import { EmptyHint } from "../components/EmptyHint";
import { NotConnected } from "../components/NotConnected";
import type { Navigate } from "../routes";

function Dashboard({ data, onNavigate }: { data: Projects; onNavigate: Navigate }) {
  const active = data.projects.filter((p) => p.active);
  const other = data.projects.filter((p) => !p.active);
  return (
    <div className="projects">
      {data.projects.length === 0 ? (
        <section className="card">
          <EmptyHint lead="No project notes yet." guide="projects" onNavigate={onNavigate}>
            Add a note with <code>type: project</code> under <code>Projects/</code> in your vault,
            with <code>project</code>, <code>status</code> (active, paused or done),{" "}
            <code>next_step</code>, <code>updated</code>, a <code>## Steps</code> checklist (
            <code>- [ ] …</code>) and an optional <code>## Log</code> list.
          </EmptyHint>
        </section>
      ) : (
        <>
          <section aria-labelledby="projects-active">
            <h2 id="projects-active" className="kicker">
              Active
            </h2>
            {active.length === 0 ? (
              <EmptyHint lead="No active projects.">
                Set <code>status: active</code> on a project note to see it here and on Today.
              </EmptyHint>
            ) : (
              <div className="projects__list">
                {active.map((p) => (
                  <ProjectCard key={p.path} project={p} />
                ))}
              </div>
            )}
          </section>
          {other.length > 0 && (
            <section aria-labelledby="projects-other">
              <h2 id="projects-other" className="kicker">
                Other
              </h2>
              <div className="projects__list">
                {other.map((p) => (
                  <ProjectCard key={p.path} project={p} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
      {data.parseErrors > 0 && (
        <p className="notice" role="status">
          {data.parseErrors} project note{data.parseErrors === 1 ? "" : "s"} could not be read.
          Check their fields.
        </p>
      )}
    </div>
  );
}

export function ProjectsPage({ onNavigate }: { onNavigate: Navigate }) {
  const [response, setResponse] = useState<ProjectsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    getProjects()
      .then((r) => {
        setResponse(r);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(typeof err === "string" ? err : "Could not load projects.");
      });
  }, []);

  useEffect(() => {
    load();
    let unsubscribe: (() => void) | undefined;
    let active = true;
    onIndexUpdated(load)
      .then((u) => {
        if (active) unsubscribe = u;
        else u();
      })
      .catch(() => undefined);
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [load]);

  const ready = response?.status === "ready" ? response.projects : null;
  const activeCount = ready?.projects.filter((p) => p.active).length ?? 0;

  return (
    <>
      <header className="page-header">
        <p className="kicker">Build</p>
        <h1 className="page-title">Projects</h1>
        {ready && ready.projects.length > 0 && (
          <p className="muted">
            {activeCount} active of {ready.projects.length} project
            {ready.projects.length === 1 ? "" : "s"}
          </p>
        )}
      </header>
      {error && (
        <p className="setting__error" role="alert">
          {error}
        </p>
      )}
      {response?.status === "noVault" && (
        <NotConnected onNavigate={onNavigate}>
          Choose your Life OS vault folder to see your projects and where to resume.
        </NotConnected>
      )}
      {ready && <Dashboard data={ready} onNavigate={onNavigate} />}
    </>
  );
}
