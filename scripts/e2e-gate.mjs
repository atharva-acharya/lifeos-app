// Release gate for the end-to-end suite (docs/phase-3-plan.md, PR B).
// Hosted runners cannot start WebView2, so the suite runs here: this builds
// the app from a clean checkout of the current commit, runs every e2e test,
// and only then records a passing "e2e (local)" status on that commit. The
// release workflow refuses to publish a commit without it.
import { execFileSync } from "node:child_process";

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32", ...opts });
const out = (cmd, args) =>
  execFileSync(cmd, args, { encoding: "utf8", shell: process.platform === "win32" }).trim();

if (out("git", ["status", "--porcelain"]) !== "") {
  console.error("e2e gate: commit or stash your changes first; the result must match a commit.");
  process.exit(1);
}
const sha = out("git", ["rev-parse", "HEAD"]);
out("git", ["fetch", "--quiet", "origin"]);
if (out("git", ["branch", "-r", "--contains", sha]) === "") {
  console.error(`e2e gate: ${sha} is not on GitHub yet; push it first.`);
  process.exit(1);
}
const repo = out("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);

run("pnpm", ["tauri", "build", "--debug", "--no-bundle"]);
try {
  run("pnpm", ["e2e"]);
} catch {
  console.error("e2e gate: the suite failed; no status recorded.");
  process.exit(1);
}

run("gh", [
  "api",
  `repos/${repo}/statuses/${sha}`,
  "-f",
  "state=success",
  "-f",
  "context=e2e (local)",
  "-f",
  "description=End-to-end suite passed on the built app",
]);
console.log(`e2e gate: recorded a passing "e2e (local)" status on ${sha}.`);
