import { useEffect, useState } from "react";
import { getDiagnostics, type Diagnostics } from "../api";

/** Plain-text report for pasting into an issue or a chat. */
export function diagnosticsText(d: Diagnostics): string {
  const log = d.log.length > 0 ? d.log.join("\n") : "(no errors logged)";
  return `Life OS ${d.version} on ${d.os}\n\nRecent errors (oldest first):\n${log}\n`;
}

/** Settings section: app version, error count and "Copy diagnostics". */
export function DiagnosticsSettings() {
  const [diag, setDiag] = useState<Diagnostics | null>(null);
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    getDiagnostics()
      .then(setDiag)
      .catch(() => undefined);
  }, []);

  const copy = () => {
    getDiagnostics()
      .then((d) => {
        setDiag(d);
        return navigator.clipboard.writeText(diagnosticsText(d));
      })
      .then(() => {
        setCopied("copied");
      })
      .catch(() => {
        setCopied("failed");
      });
  };

  return (
    <section className="card setting" aria-labelledby="diag-heading">
      <div className="setting__text">
        <h2 id="diag-heading" className="setting__title">
          Diagnostics
        </h2>
        <p className="setting__help">
          Errors are kept in a small log on this PC and never sent anywhere. Copy them when
          reporting a problem.
        </p>
        <p className="setting__value">
          {diag ? (
            <>
              <span className="pill pill--read">Version {diag.version}</span>
              {diag.log.length === 0
                ? "No errors logged"
                : `${String(diag.log.length)} recent ${diag.log.length === 1 ? "error" : "errors"} logged`}
            </>
          ) : (
            "Loading…"
          )}
        </p>
        <p className="sr-only" role="status">
          {copied === "copied" ? "Diagnostics copied to the clipboard." : ""}
        </p>
        {copied === "failed" && (
          <p className="setting__error" role="alert">
            Could not copy to the clipboard. Please try again.
          </p>
        )}
      </div>
      <button type="button" className="button" onClick={copy}>
        {copied === "copied" ? "Copied" : "Copy diagnostics"}
      </button>
    </section>
  );
}
