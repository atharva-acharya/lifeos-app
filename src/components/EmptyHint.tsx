import { useState, type ReactNode } from "react";
import { CHECKLIST_GUIDES, type GuideId } from "../guides";
import type { Navigate } from "../routes";
import { GuidePanel } from "./GuidePanel";

/**
 * Says what is missing and which note would fill it. `lead` is the plain
 * empty message; `children` names the note type and fields. The guide link
 * opens Settings at the checklist item, or expands the template in place for
 * notes that are not on the checklist.
 */
export function EmptyHint({
  lead,
  guide,
  onNavigate,
  children,
}: {
  lead: string;
  guide?: GuideId;
  onNavigate?: Navigate;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const inSettings = guide !== undefined && CHECKLIST_GUIDES.includes(guide);

  return (
    <div className="empty-hint">
      <p className="muted">{lead}</p>
      {children && <p className="empty-hint__how">{children}</p>}
      {guide && (inSettings ? onNavigate : true) && (
        <button
          type="button"
          className="button button--quiet"
          aria-expanded={inSettings ? undefined : open}
          onClick={() => {
            if (inSettings) onNavigate?.("settings", guide);
            else setOpen((o) => !o);
          }}
        >
          How to set this up
        </button>
      )}
      {guide && !inSettings && open && <GuidePanel id={guide} />}
    </div>
  );
}
