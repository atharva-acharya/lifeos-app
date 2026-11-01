// Release gate for the end-to-end suite (ADR 0007). Hosted runners cannot
// start WebView2, so the owner runs this: it checks out the current commit
// into a fresh, detached worktree, installs dependencies from the lockfile,
// builds the app, runs every e2e test there, and only then records a passing
// "e2e (local)" status on that exact commit. The release workflow refuses to
// publish a commit without it. Edits in this checkout cannot affect the run.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";

const win = process.platform === "win32";
// git and gh are real executables: no shell, so arguments with spaces stay whole.
const out = (cmd, args, cwd) => execFileSync(cmd, args, { encoding: "utf8", cwd }).trim();
const run = (cmd, args, cwd) => execFileSync(cmd, args, { stdio: "inherit", cwd });
// pnpm is a .cmd shim on Windows, which needs a shell; its arguments have no spaces.
const pnpm = (args, cwd) => execFileSync("pnpm", args, { stdio: "inherit", cwd, shell: win });

// A Life OS window that is already open shares WebView2's data folder with
// the test build, which then cannot start (WebView2 error 0x8007139F).
if (win) {
  const tasks = out("tasklist", ["/FI", "IMAGENAME eq lifeos-app.exe", "/NH"]);
  if (tasks.toLowerCase().includes("lifeos-app.exe")) {
    console.error(
      "e2e gate: Life OS is running. Close it (and end lifeos-app.exe in Task Manager), then run this again.",
    );
    process.exit(1);
  }
}

const sha = out("git", ["rev-parse", "HEAD"]);
out("git", ["fetch", "--quiet", "origin"]);
if (out("git", ["branch", "-r", "--contains", sha]) === "") {
  console.error(`e2e gate: ${sha} is not on GitHub yet; push it first.`);
  process.exit(1);
}
const repo = out("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);

// Windows: the temp folder is deep, and node_modules and the Rust build add
// long paths of their own, which passes the 260-character limit (half-linked
// packages, "Filename too long" on cleanup). A short folder at the drive root
// avoids it; elsewhere the temp folder is fine.
let base = tmpdir();
if (win) {
  base = join(parse(process.cwd()).root, "le2e");
  mkdirSync(base, { recursive: true });
}
const dir = join(mkdtempSync(join(base, "g-")), "c");
const longPaths = ["-c", "core.longpaths=true"];
run("git", [...longPaths, "worktree", "add", "--detach", dir, sha]);
let passed = false;
try {
  pnpm(["install", "--frozen-lockfile"], dir);
  pnpm(["tauri", "build", "--debug", "--no-bundle"], dir);
  pnpm(["e2e"], dir);
  passed = out("git", ["rev-parse", "HEAD"], dir) === sha;
} catch {
  passed = false;
} finally {
  try {
    run("git", [...longPaths, "worktree", "remove", "--force", dir]);
  } catch {
    // A failed clean-up must not hide the result; `git worktree prune` and
    // deleting the folder later is enough.
    console.warn(`e2e gate: could not delete ${dir}; delete it by hand later.`);
  }
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
