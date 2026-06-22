#!/usr/bin/env node
// guild-connect: repo-setup.mjs (U2) — clone the member's personal repo into the
// project's repo/ subfolder and seed the COF's durable layer (memory, skills,
// Tools) without ever clobbering existing content.
//
//   node repo-setup.mjs '{"targetDir":"<project>","forgejoHost":"<host>","username":"<user>"}'
//
// host + username are PASSED IN — taken from git-setup.mjs's own stdout and
// threaded through the choreography. repo-setup deliberately does NOT call
// /api/account/git-access: that route mints a fresh per-device git token, and
// re-minting would rotate and invalidate the credential git-setup just stored in
// the OS keychain. Auth for the clone/push is the durable git credential
// git-setup already installed.
//
// Re-run safety (the safety mechanism lives HERE, not in the choreography):
//   - clone only when repo/ is not already a git repo; NEVER pull an existing
//     clone (the COF owns its own repo sync — pulling could hard-fail on local
//     commits or a dirty tree),
//   - seed-only-if-absent: write a seed file only when it's missing,
//   - commit only when something was seeded; push only when local is ahead of
//     (or has no) upstream — so a second run, or a second machine cloning an
//     already-populated repo, makes zero commits.
//
// Empty-remote first run: a brand-new personal repo has no commits and no
// default branch. After seeding we `push -u origin HEAD`, which publishes the
// local branch under its own name and sets upstream — no hard-coded branch name.
//
// Security: GIT_TERMINAL_PROMPT=0 so a missing credential fails fast instead of
// hanging on a prompt; git stderr is scrubbed of any URL-embedded credential
// before it is ever logged; the token is never printed.

import { spawn } from "node:child_process";
import { mkdir, writeFile as fsWriteFile, readFile, access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parseJsonArg, runCommand } from "./api.mjs";
import { parseForgejoHost } from "./git-setup.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SEED_ROOT = resolve(HERE, "..", "assets", "repo-seeds");

/** Repo-relative seed files, written only when absent (KTD: seed-only-if-absent). */
export const SEED_FILES = ["memory/MEMORY.md", "skills/README.md", "Tools/README.md"];

const SEED_COMMIT_MSG = "Seed COF portable repo (memory, skills, Tools)";

/** A locally classified failure whose message is safe to print (no token, no raw body). */
export class RepoSetupError extends Error {
  constructor(message) {
    super(message);
    this.name = "RepoSetupError";
  }
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

/** The member's personal-repo clone URL. Tolerates a host passed as a bare host or full URL. */
export function personalCloneUrl({ host, username }) {
  return `https://${parseForgejoHost(host)}/${username}/personal.git`;
}

/** Given the repo-relative paths that already exist, return the seed files still missing. */
export function seedPlan(existingPaths) {
  const have = new Set(existingPaths || []);
  return SEED_FILES.filter((rel) => !have.has(rel));
}

/** Strip any `https://user:token@host` embedded credential from git output before logging it. */
export function scrubGitStderr(text) {
  return String(text == null ? "" : text).replace(/(https?:\/\/)[^/@\s]+:[^/@\s]*@/gi, "$1***@");
}

// ---------------------------------------------------------------------------
// Orchestrator (deps injected for tests)
// ---------------------------------------------------------------------------

/**
 * deps:
 *   join(...parts) → string                       (path join — injected so tests stay platform-stable)
 *   pathExists(abs) → Promise<boolean>
 *   ensureDir(abs) → Promise<void>
 *   readSeed(rel) → Promise<string>               (seed file content)
 *   writeSeed(repoDir, rel, content) → Promise    (mkdir -p + write)
 *   runGit(args, { cwd, input }) → { code, stdout, stderr }   (rejects only if git can't spawn)
 *   log(line) → void
 *
 * opts: { targetDir, host, username }
 */
export async function runRepoSetup(deps, opts = {}) {
  const targetDir = opts.targetDir;
  if (!targetDir) throw new RepoSetupError("repo-setup needs a targetDir.");
  const host = parseForgejoHost(opts.host);
  const username = opts.username;
  if (!host || !username) {
    throw new RepoSetupError(
      "repo-setup needs the Forgejo host and username from git-setup. Run git-setup first.",
    );
  }

  const repoDir = deps.join(targetDir, "repo");
  const url = personalCloneUrl({ host, username });

  // 1. Clone only when repo/ is not already a git repo. NEVER pull an existing clone.
  const cloned = await deps.pathExists(deps.join(repoDir, ".git"));
  if (!cloned) {
    await deps.ensureDir(targetDir);
    const c = await deps.runGit(["clone", url, repoDir], {});
    if (c.code !== 0) {
      deps.log("git clone failed: " + scrubGitStderr(c.stderr));
      throw new RepoSetupError(
        "Couldn't clone your personal repo. Make sure git-setup ran and your network is up, then run repo-setup again.",
      );
    }
  }

  // 2. Seed only what's absent.
  const existing = [];
  for (const rel of SEED_FILES) {
    if (await deps.pathExists(deps.join(repoDir, rel))) existing.push(rel);
  }
  const plan = seedPlan(existing);
  for (const rel of plan) {
    const content = await deps.readSeed(rel);
    await deps.writeSeed(repoDir, rel, content);
  }

  // 3. Commit only when something was seeded.
  if (plan.length) {
    const add = await deps.runGit(["add", "-A"], { cwd: repoDir });
    if (add.code !== 0) throw new RepoSetupError("git add failed while seeding the repo.");
    const commit = await deps.runGit(["commit", "-m", SEED_COMMIT_MSG], { cwd: repoDir });
    if (commit.code !== 0) throw new RepoSetupError("git commit failed while seeding the repo.");
  }

  // 4. Push: no upstream (empty remote) → push -u origin HEAD; else push only when ahead.
  let pushed = false;
  const upstream = await deps.runGit(
    ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    { cwd: repoDir },
  );
  if (upstream.code !== 0) {
    const head = await deps.runGit(["rev-parse", "HEAD"], { cwd: repoDir });
    if (head.code === 0) {
      const p = await deps.runGit(["push", "-u", "origin", "HEAD"], { cwd: repoDir });
      if (p.code !== 0) {
        deps.log("git push failed: " + scrubGitStderr(p.stderr));
        throw new RepoSetupError(
          "Seeded locally but couldn't push to your personal repo. Check git-setup and your network, then run repo-setup again.",
        );
      }
      pushed = true;
    }
  } else {
    const ahead = await deps.runGit(["rev-list", "--count", "@{u}..HEAD"], { cwd: repoDir });
    const count = (ahead.stdout || "").trim();
    if (ahead.code === 0 && count !== "" && count !== "0") {
      const p = await deps.runGit(["push"], { cwd: repoDir });
      if (p.code !== 0) {
        deps.log("git push failed: " + scrubGitStderr(p.stderr));
        throw new RepoSetupError(
          "Couldn't push your local changes to your personal repo. Check git-setup and your network, then run repo-setup again.",
        );
      }
      pushed = true;
    }
  }

  deps.log(
    "Personal repo ready at " + repoDir + (pushed ? " (pushed seeds)" : "") + ".",
  );
  return { ok: true, repoDir, cloned, seeded: plan, pushed };
}

// ---------------------------------------------------------------------------
// Real dependency wiring (CLI)
// ---------------------------------------------------------------------------

function realRunGit(args, opts = {}) {
  return new Promise((resolve_, reject) => {
    // GIT_TERMINAL_PROMPT=0 so a missing/declined credential fails fast with a
    // non-zero exit instead of blocking on an interactive prompt.
    const child = spawn("git", args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: opts.cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolve_({ code: code ?? 0, stdout, stderr }));
    child.stdin.end(opts.input ?? "");
  });
}

async function exists(p) {
  return access(p).then(() => true, () => false);
}

const realDeps = {
  join,
  pathExists: exists,
  ensureDir: (abs) => mkdir(abs, { recursive: true }).then(() => undefined),
  readSeed: (rel) => readFile(resolve(SEED_ROOT, ...rel.split("/")), "utf8"),
  writeSeed: async (repoDir, rel, content) => {
    const abs = join(repoDir, ...rel.split("/"));
    await mkdir(dirname(abs), { recursive: true });
    await fsWriteFile(abs, content);
  },
  runGit: realRunGit,
  log: (line) => process.stderr.write(`${line}\n`),
};

const USAGE =
  'Usage: node repo-setup.mjs \'{"targetDir":"...","forgejoHost":"...","username":"..."}\'';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCommand(async () => {
    const cfg = parseJsonArg(process.argv[2], USAGE);
    return runRepoSetup(realDeps, {
      targetDir: cfg.targetDir,
      host: cfg.forgejoHost ?? cfg.host,
      username: cfg.username,
    });
  });
}
