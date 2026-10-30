// Release gate for the end-to-end suite (ADR 0007). Hosted runners cannot
// start WebView2, so the owner runs this: it checks out the current commit
// into a fresh, detached worktree, installs dependencies from the lockfile,
// builds the app, runs every e2e test there, and only then records a passing
// "e2e (local)" status on that exact commit. The release workflow refuses to
// publish a commit without it. Edits in this checkout cannot affect the run.
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const win = process.platform === "win32";
// git and gh are real executables: no shell, so arguments with spaces stay whole.
const out = (cmd, args, cwd) => execFileSync(cmd, args, { encoding: "utf8", cwd }).trim();
const run = (cmd, args, cwd) => execFileSync(cmd, args, { stdio: "inherit", cwd });
// pnpm is a .cmd shim on Windows, which needs a shell; its arguments have no spaces.
const pnpm = (args, cwd) => execFileSync("pnpm", args, { stdio: "inherit", cwd, shell: win });

const sha = out("git", ["rev-parse", "HEAD"]);
out("git", ["fetch", "--quiet", "origin"]);
if (out("git", ["branch", "-r", "--contains", sha]) === "") {
  console.error(`e2e gate: ${sha} is not on GitHub yet; push it first.`);
  process.exit(1);
}
const repo = out("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);

const dir = join(mkdtempSync(join(tmpdir(), "lifeos-e2e-gate-")), "checkout");
run("git", ["worktree", "add", "--detach", dir, sha]);
let passed = false;
try {
  pnpm(["install", "--frozen-lockfile"], dir);
  pnpm(["tauri", "build", "--debug", "--no-bundle"], dir);
  pnpm(["e2e"], dir);
  passed = out("git", ["rev-parse", "HEAD"], dir) === sha;
} catch {
  passed = false;
} finally {
  run("git", ["worktree", "remove", "--force", dir]);
}

if (!passed) {
  console.error("e2e gate: the suite did not pass; no status recorded.");
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
