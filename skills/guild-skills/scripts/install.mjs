#!/usr/bin/env node
// guild-skills: install.mjs — install catalog skills at their curator pins
// (skills-delivery U5; R9/R10/R11/R20/R22).
//
//   node install.mjs --slugs=a,b [--scope=project|global|profile] [--force]
//
// Per skill: shallow-fetch the pinned commit into a temp clone, stage the skill
// in a hidden dir on the destination filesystem, then ATOMICALLY rename it into
// place (never overlay-merging, so a file removed upstream cannot linger).
// Writes the v2 lockfile entry only after the files land. Re-running is
// idempotent (same pin + clean local copy → no-op). A locally-modified skill is
// NOT overwritten without --force (R20); the member is pointed at harvest.
//
// Selection is explicit slugs — no interactive prompt inside the script. The
// SKILL.md instructs the AI client to present the recommendation list and pass
// the chosen slugs. Stdout is machine-readable JSON; human copy to stderr.

import { mkdtemp, mkdir, rename, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { readLockfile, upsertEntry, hashSkillDir, localState } from "./lockfile.mjs";
import { fetchSkillAtPin, FetchError } from "./fetch-skill.mjs";
import { resolveScope, defaultContext } from "./scopes.mjs";
import { fetchRecommendations, indexBySlug, actingAs, runCommand } from "./catalog.mjs";

const exists = (p) => access(p).then(() => true, () => false);

/**
 * Install one resolved catalog entry into a scope root. Returns a per-skill
 * result — never throws for expected outcomes (unreachable source, missing
 * path, locally-modified block); those are reported so a batch continues.
 */
export async function installOne({ entry, scope, root, force }, deps = {}) {
  const fetchSkill = deps.fetchSkill ?? fetchSkillAtPin;
  const doRename = deps.rename ?? rename;
  const doRm = deps.rm ?? rm;
  const slug = entry.slug;
  const targetDir = join(root.skillsDir, slug);
  const lock = await readLockfile(root.lockfile);
  const existing = lock.skills[slug];

  if (existing) {
    const state = await localState(targetDir, existing.computedHash);
    if (state === "modified" && !force) {
      return {
        slug,
        status: "blocked-modified",
        detail: "Locally modified — harvest it, or reinstall with --force to discard your changes.",
      };
    }
    if (
      state === "clean" &&
      existing.pinnedCommit === entry.pinnedCommit &&
      existing.source === entry.sourceRepo &&
      existing.skillPath === entry.sourcePath
    ) {
      return { slug, status: "noop", detail: "Already installed at this pin." };
    }
  }

  await mkdir(root.skillsDir, { recursive: true });
  const stageDir = join(root.skillsDir, `.stage-${randomBytes(6).toString("hex")}`);
  const workDir = await mkdtemp(join(tmpdir(), "guild-fetch-"));
  try {
    await fetchSkill({
      repo: entry.sourceRepo,
      skillPath: entry.sourcePath,
      commit: entry.pinnedCommit,
      stageDir,
      workDir,
    });
  } catch (err) {
    await doRm(stageDir, { recursive: true, force: true }).catch(() => {});
    await doRm(workDir, { recursive: true, force: true }).catch(() => {});
    if (err instanceof FetchError) {
      const label = err.kind === "unreachable" ? "source-unreachable" : "not-found";
      return { slug, status: "error", detail: `${label}: ${err.message}` };
    }
    throw err;
  }

  // Atomic replace: move any existing copy aside, rename the stage into place,
  // then drop the backup. On failure the old copy is restored — so an
  // interruption here leaves no partial skill dir and no lockfile entry.
  let backup = null;
  try {
    if (await exists(targetDir)) {
      backup = `${targetDir}.old-${randomBytes(6).toString("hex")}`;
      await doRename(targetDir, backup);
    }
    await doRename(stageDir, targetDir);
  } catch (err) {
    await doRm(stageDir, { recursive: true, force: true }).catch(() => {});
    if (backup) await doRename(backup, targetDir).catch(() => {});
    return { slug, status: "error", detail: `install-failed: ${err?.message ?? "rename failed"}` };
  }
  if (backup) await doRm(backup, { recursive: true, force: true }).catch(() => {});

  const computedHash = await hashSkillDir(targetDir);
  await upsertEntry(root.lockfile, slug, {
    source: entry.sourceRepo,
    sourceType: "github",
    skillPath: entry.sourcePath,
    pinnedCommit: entry.pinnedCommit,
    computedHash,
    scope,
    fork: false,
    catalogSlug: slug,
    originalSource: entry.originalSourceRepo ?? null,
  });

  return {
    slug,
    status: "installed",
    detail: existing ? "reinstalled at pin" : "installed",
    dependencyNotes: entry.dependencyNotes ?? null,
  };
}

/** Resolve slugs against the member's recommendations and install each. */
export async function installSkills({
  slugs,
  scope = "project",
  force = false,
  ctx = defaultContext(),
  deps = {},
}) {
  const root = resolveScope(scope, ctx);
  const catalog = deps.fetchCatalog ? await deps.fetchCatalog() : await fetchRecommendations();
  const bySlug = indexBySlug(catalog);

  const results = [];
  for (const slug of slugs) {
    const entry = bySlug.get(slug);
    if (!entry) {
      results.push({ slug, status: "error", detail: "unknown-slug: not in your recommendations." });
      continue;
    }
    try {
      results.push(await installOne({ entry, scope, root, force }, deps));
    } catch (err) {
      results.push({ slug, status: "error", detail: err?.message ?? "install failed" });
    }
  }
  return {
    ok: results.every((r) => r.status !== "error"),
    scope,
    skillsDir: root.skillsDir,
    results,
  };
}

// --- CLI --------------------------------------------------------------------

export function parseArgs(argv) {
  const out = { slugs: [], scope: "project", force: false };
  for (const a of argv) {
    if (a.startsWith("--slugs=")) {
      out.slugs = a
        .slice("--slugs=".length)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (a.startsWith("--scope=")) {
      out.scope = a.slice("--scope=".length);
    } else if (a === "--force") {
      out.force = true;
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.slugs.length === 0) {
    throw new Error("Usage: node install.mjs --slugs=a,b [--scope=project|global|profile] [--force]");
  }
  await actingAs(); // connect-first preflight + "Acting as <email>" banner
  return installSkills(args);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCommand(main);
}
