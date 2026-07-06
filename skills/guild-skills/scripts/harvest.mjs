#!/usr/bin/env node
// guild-skills: harvest.mjs — push a personalized skill into the member's
// personal Forgejo repo and mark it a fork (skills-delivery U7; R15/R16).
//
//   node harvest.mjs --slug=<slug>
//
// Fork-and-own: a personalized skill is a new creation. Harvest copies the
// installed skill into `skills/<slug>/` in the member's private personal repo
// (a FIXED path — a second, differently-personalized variant overwrites the
// first in the working tree, recoverable via git history), records its
// provenance, commits and pushes, then flips the lockfile entry to a fork with
// its original source pointer retained. From then on updates skip it (R16). The
// lockfile is flipped ONLY after a successful push, so a push failure never
// leaves a "fork" that was never saved. No GitHub account is needed — auth is
// the member's durable Guild git credential (git-access device token).
//
// Client-side git only; there is no server push path. Stdout JSON; human copy to
// stderr. Credentials are never printed (git output is scrubbed).

import { spawn } from "node:child_process";
import { cp, rm, mkdir, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readLockfile, upsertEntry, localState } from "./lockfile.mjs";
import { allScopes, defaultContext } from "./scopes.mjs";
import { postJson } from "../../guild-connect/scripts/api.mjs";
import { actingAs, runCommand } from "./catalog.mjs";

const exists = (p) => access(p).then(() => true, () => false);

/** Strip any `https://user:token@host` embedded credential before logging. */
export function scrubGitStderr(text) {
  return String(text == null ? "" : text).replace(/(https?:\/\/)[^/@\s]+:[^/@\s]*@/gi, "$1***@");
}

/** Provenance recorded alongside the harvested skill (deterministic content). */
export function provenanceContent(entry) {
  return `${JSON.stringify(
    {
      source: entry.source ?? null,
      skillPath: entry.skillPath ?? null,
      pinnedCommit: entry.pinnedCommit ?? null,
      originalSource: entry.originalSource ?? null,
    },
    null,
    2,
  )}\n`;
}

/** Authenticated one-shot clone/push URL. Kept out of logs by scrubGitStderr. */
export function authRemoteUrl({ host, username, token }) {
  const bare = String(host).replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `https://${encodeURIComponent(username)}:${encodeURIComponent(token)}@${bare}/${username}/personal.git`;
}

/**
 * Copy the installed skill into the personal repo clone, commit, and push;
 * flip the lockfile entry to a fork only on a successful push.
 *
 * deps: { runGit(args,{cwd}) → {code,stdout,stderr}, cp, rm, mkdir, writeFile }.
 */
export async function harvestOne({ slug, ctx = defaultContext(), repoDir, deps = {} }) {
  const runGit = deps.runGit ?? realRunGit;
  const doCp = deps.cp ?? cp;
  const doRm = deps.rm ?? rm;
  const doMkdir = deps.mkdir ?? mkdir;
  const doWrite = deps.writeFile ?? writeFile;

  // Locate the installed copy across scopes (project first, then global).
  let found = null;
  for (const root of allScopes(ctx)) {
    const lock = await readLockfile(root.lockfile);
    if (slug in lock.skills) {
      found = { root, entry: lock.skills[slug] };
      break;
    }
  }
  if (!found) return { slug, status: "error", detail: "not-installed: no lockfile entry for this slug." };

  const skillDir = join(found.root.skillsDir, slug);
  const state = await localState(skillDir, found.entry.computedHash);
  if (state === "missing") {
    return { slug, status: "error", detail: "missing: the skill's files are not on disk." };
  }

  // Copy into the FIXED skills/<slug>/ path (overwriting any prior variant).
  const dest = join(repoDir, "skills", slug);
  await doRm(dest, { recursive: true, force: true }).catch(() => {});
  await doMkdir(dest, { recursive: true });
  await doCp(skillDir, dest, { recursive: true });
  await doWrite(join(dest, ".guild-source.json"), provenanceContent(found.entry));

  // Commit + push. Any git failure aborts BEFORE the fork flip.
  const rel = `skills/${slug}`;
  const add = await runGit(["add", "--", rel], { cwd: repoDir });
  if (add.code !== 0) return gitError(slug, "add", add);
  const msg = `harvest: ${slug} from ${found.entry.source ?? "?"}@${(found.entry.pinnedCommit ?? "").slice(0, 12)}`;
  const commit = await runGit(["commit", "-m", msg], { cwd: repoDir });
  // An empty commit (nothing changed vs. a prior harvest) is not a failure.
  if (commit.code !== 0 && !/nothing to commit/i.test(commit.stdout + commit.stderr)) {
    return gitError(slug, "commit", commit);
  }
  const push = await runGit(["push", "origin", "HEAD"], { cwd: repoDir });
  if (push.code !== 0) return gitError(slug, "push", push);

  // Push succeeded — NOW flip the lockfile entry to a fork (source retained).
  await upsertEntry(found.root.lockfile, slug, { ...found.entry, fork: true });

  return {
    slug,
    status: "harvested",
    scope: found.root.scope,
    unmodified: state === "clean",
    detail: state === "clean" ? "harvested (was unmodified — fork-and-own)" : "harvested",
  };
}

function gitError(slug, step, r) {
  return {
    slug,
    status: "error",
    detail: `git-${step}-failed: ${scrubGitStderr(r.stderr).slice(0, 200)}`,
  };
}

function realRunGit(args, opts = {}) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let child;
    try {
      child = spawn("git", args, {
        cwd: opts.cwd,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      });
    } catch {
      resolve({ code: -1, stdout: "", stderr: "git not found on PATH" });
      return;
    }
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", () => resolve({ code: -1, stdout, stderr: "git failed to spawn" }));
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

// --- CLI --------------------------------------------------------------------

async function ensurePersonalClone({ host, username, token, workDir }) {
  await mkdir(workDir, { recursive: true });
  const repoDir = join(workDir, "personal");
  if (await exists(join(repoDir, ".git"))) return repoDir;
  const url = authRemoteUrl({ host, username, token });
  const r = await realRunGit(["clone", url, repoDir], {});
  if (r.code !== 0) {
    throw new Error(`Couldn't clone your personal repo: ${scrubGitStderr(r.stderr).slice(0, 200)}`);
  }
  // Re-point origin at the credential-free URL so the token is not persisted in
  // the clone's git config; the push above already authenticated.
  const clean = `https://${String(host).replace(/^https?:\/\//, "").replace(/\/+$/, "")}/${username}/personal.git`;
  await realRunGit(["remote", "set-url", "origin", clean], { cwd: repoDir });
  return repoDir;
}

function parseHarvestArgs(argv) {
  let slug = null;
  for (const a of argv) if (a.startsWith("--slug=")) slug = a.slice(7).trim();
  return { slug };
}

async function main() {
  const { slug } = parseHarvestArgs(process.argv.slice(2));
  if (!slug) throw new Error("Usage: node harvest.mjs --slug=<slug>");
  await actingAs();

  // Mint a device git token + learn host/username (reuses the durable flow).
  const access = await postJson("/api/account/git-access", { device: "harvest" });
  const workDir = join(process.cwd(), ".guild-harvest");
  const repoDir = await ensurePersonalClone({
    host: access.forgejoHost,
    username: access.username,
    token: access.token,
    workDir,
  });
  // Push with the authenticated URL for this one operation.
  const pushUrl = authRemoteUrl({ host: access.forgejoHost, username: access.username, token: access.token });
  await realRunGit(["remote", "set-url", "origin", pushUrl], { cwd: repoDir });
  try {
    return await harvestOne({ slug, repoDir });
  } finally {
    const clean = `https://${String(access.forgejoHost).replace(/^https?:\/\//, "").replace(/\/+$/, "")}/${access.username}/personal.git`;
    await realRunGit(["remote", "set-url", "origin", clean], { cwd: repoDir }).catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCommand(main);
}
