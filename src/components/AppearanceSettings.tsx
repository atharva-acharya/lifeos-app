import { useReduceTransparency } from "../appearance";

/**
 * Settings section: "Reduce transparency" turns every glass surface solid
 * (ui-spec L5). Stored on this PC only; the system setting applies as well.
 */
export function AppearanceSettings() {
  const [reduced, setReduced] = useReduceTransparency();
  return (
    <section className="card setting" aria-labelledby="appearance-heading">
      <div className="setting__text">
        <h2 id="appearance-heading" className="setting__title">
          Appearance
        </h2>
        <p className="setting__help">
          The sidebar is see-through glass. Make it solid if that is easier to read. Windows&apos;
          own transparency setting is followed too.
        </p>
        <label className="setting__check">
          <input
            type="checkbox"
            checked={reduced}
            onChange={(e) => {
              setReduced(e.target.checked);
            }}
          />
          Reduce transparency
        </label>
      </div>
    </section>
  );
}
