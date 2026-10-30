import { useState } from "react";
import { localDate } from "../api";
import { GUIDES, type GuideId } from "../guides";

type CopyState = "idle" | "copied" | "failed";

/** The suggested path, a front matter template to copy, and one line per field. */
export function GuidePanel({ id, today = localDate() }: { id: GuideId; today?: string }) {
  const guide = GUIDES[id];
  const template = guide.template(today);
  const [copy, setCopy] = useState<CopyState>("idle");

  const onCopy = () => {
    // The clipboard can be missing or refuse (permissions); say so, never throw.
    Promise.resolve()
      .then(() => navigator.clipboard.writeText(template))
      .then(() => {
        setCopy("copied");
      })
      .catch(() => {
        setCopy("failed");
      });
  };

  return (
    <div className="guide" role="group" aria-label={`${guide.title} guide`}>
      <p className="guide__path">
        Suggested path: <code className="path">{guide.path}</code>
      </p>
      <pre className="guide__code">
        <code>{template}</code>
      </pre>
      <div className="guide__actions">
        <button type="button" className="button" onClick={onCopy}>
          Copy
        </button>
        {copy === "copied" && (
          <span className="muted" role="status">
            Copied
          </span>
        )}
        {copy === "failed" && (
          <span className="setting__error" role="status">
            Copy failed. Select the text above and copy it by hand.
          </span>
        )}
      </div>
      <dl className="guide__fields">
        {guide.fields.map((f) => (
          <div key={f.name}>
            <dt>
              <code>{f.name}</code>
            </dt>
            <dd>{f.text}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
