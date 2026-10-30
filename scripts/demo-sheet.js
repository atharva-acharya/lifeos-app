// Synthetic Sheet data for README screenshots (requirements: no personal data
// in screenshots). Run `pnpm dev`, open http://localhost:1420, paste this into
// the browser console, then click Jobs > Charts. Seeded, so output repeats.
const sources = [
  "LinkedIn Easy Apply",
  "LinkedIn Easy Apply",
  "LinkedIn Easy Apply",
  "Company site",
  "Company site",
  "Indeed",
  "Agency",
];
const odds = {
  "LinkedIn Easy Apply": [0.04, 0.1],
  "Company site": [0.12, 0.22],
  Indeed: [0.05, 0.12],
  Agency: [0.08, 0.15],
};
let seed = 7;
const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
const blank = {
  company: null,
  role: "SOC Analyst",
  inbox: null,
  lastUpdate: null,
  daysSince: null,
  followUp: null,
  email: null,
  notes: null,
  messageId: null,
};
const rows = [];
for (let i = 0; i < 150; i++) {
  const d = new Date();
  d.setDate(d.getDate() - Math.floor(rnd() * rnd() * 84));
  const source = sources[Math.floor(rnd() * sources.length)];
  const [p, r] = odds[source];
  const x = rnd();
  const status =
    x < p ? (rnd() < 0.5 ? "Interview" : "Assessment") : x < p + r ? "Rejected" : "Applied";
  rows.push({
    ...blank,
    company: `Example ${String(i)}`,
    applied: d.toISOString().slice(0, 10),
    source,
    status,
  });
}
for (let i = 0; i < 9; i++) {
  rows.push({ ...blank, applied: null, source: "Reply only", status: "Rejected" });
}
const view = {
  configured: true,
  connected: true,
  error: null,
  cache: { fetchedAt: Date.now(), rows, missingColumns: [] },
};
window.__TAURI_INTERNALS__ = {
  invoke: (cmd) =>
    Promise.resolve(
      cmd.endsWith("applications")
        ? view
        : cmd === "get_jobs"
          ? { status: "noVault" }
          : cmd.startsWith("plugin:event")
            ? 1
            : null,
    ),
  transformCallback: () => 1,
  unregisterCallback: () => undefined,
};
window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => undefined };
