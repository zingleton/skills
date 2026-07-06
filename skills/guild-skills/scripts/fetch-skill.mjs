// guild-skills: fetch a skill's files from GitHub at a pinned commit
// (skills-delivery U5, KTD "git shallow fetch at the pinned SHA"). Git is a
// guaranteed dependency (the setup skills install it); shallow-fetching an
// arbitrary commit avoids the unauthenticated GitHub API rate limit and any tar
// extraction. Nothing keeps the .git directory.
//
// Isolated here so the one external assumption (GitHub allows
// `git fetch --depth 1 origin <sha>`) has a single home — if it ever regresses,
// the fallback (full shallow clone of the default branch + checkout) changes
// only this file.

import { cp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve, sep } from "node:path";

export class FetchError extends Error {
  /** kind: "unreachable" (fetch/checkout failed) | "missing-path" (pin ok, path absent). */
  constructor(kind, message) {
    super(message);
    this.name = "FetchError";
    this.kind = kind;
  }
}

/**
 * owner/repo → the public HTTPS clone URL. A value that already looks like a URL
 * or a filesystem path is passed through unchanged (this is what lets tests
 * fetch from a local repo, and would allow a non-GitHub remote if ever needed).
 */
export function githubUrl(repo) {
  if (/:\/\//.test(repo) || repo.startsWith("/") || repo.startsWith(".")) return repo;
  return `https://github.com/${repo}.git`;
}

/** A skill path must stay inside the fetched tree: relative, no traversal. */
export function isSafeSkillPath(p) {
  if (typeof p !== "string" || p.length === 0) return false;
  if (p.includes("\0") || p.includes("\\")) return false;
  if (p.startsWith("/")) return false;
  return p.split("/").every((seg) => seg !== "" && seg !== "..");
}

/** Default git runner: resolves { code, stderr }; code -1 when git is absent. */
function spawnGit(args, cwd) {
  return new Promise((resolvePromise) => {
    let stderr = "";
    let child;
    try {
      child = spawn("git", args, { cwd, stdio: ["ignore", "ignore", "pipe"] });
    } catch {
      resolvePromise({ code: -1, stderr: "git not found on PATH" });
      return;
    }
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", () => resolvePromise({ code: -1, stderr: "git failed to spawn" }));
    child.on("close", (code) => resolvePromise({ code: code ?? -1, stderr }));
  });
}

/**
 * Shallow-fetch <repo>@<commit>, then copy the <skillPath> subtree into
 * `stageDir`. `workDir` is a caller-owned temp dir for the git clone (removed
 * here on success). deps.run / deps.cp injectable for tests.
 *
 * Throws FetchError("unreachable") if any git step fails and
 * FetchError("missing-path") if the pinned tree lacks skillPath.
 */
export async function fetchSkillAtPin(
  { repo, skillPath, commit, stageDir, workDir },
  deps = {},
) {
  const run = deps.run ?? spawnGit;
  const doCp = deps.cp ?? cp;
  const doRm = deps.rm ?? rm;

  if (!isSafeSkillPath(skillPath)) {
    throw new FetchError("missing-path", `Unsafe skill path "${skillPath}".`);
  }

  const steps = [
    ["init", "-q"],
    ["remote", "add", "origin", githubUrl(repo)],
    ["fetch", "-q", "--depth", "1", "origin", commit],
    ["checkout", "-q", "FETCH_HEAD"],
  ];
  for (const args of steps) {
    const { code } = await run(args, workDir);
    if (code !== 0) {
      throw new FetchError(
        "unreachable",
        `Could not fetch ${repo}@${commit.slice(0, 12)} (git ${args[0]} failed). The source may be unreachable or the commit removed.`,
      );
    }
  }

  // Defense in depth: the checked-out path must resolve inside workDir.
  const from = resolve(workDir, skillPath);
  const base = resolve(workDir) + sep;
  if (!(from + sep).startsWith(base)) {
    throw new FetchError("missing-path", `Skill path "${skillPath}" escapes the fetched tree.`);
  }

  try {
    await doCp(from, stageDir, {
      recursive: true,
      filter: (src) => !src.split(/[\\/]/).includes(".git"),
    });
  } catch (err) {
    if (err?.code === "ENOENT") {
      throw new FetchError("missing-path", `The pin has no skill at "${skillPath}".`);
    }
    throw err;
  }

  await doRm(workDir, { recursive: true, force: true }).catch(() => {});
  return { stageDir };
}
