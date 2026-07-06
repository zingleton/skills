#!/usr/bin/env node
// guild-skills: uninstall.mjs — remove a skill's files and lockfile entry
// (skills-delivery U5; R18/R20).
//
//   node uninstall.mjs --slugs=a,b [--force]
//
// Enumerates every scope root (project + global + profile) and removes the skill
// wherever it is installed. A locally-modified skill is NOT removed without
// --force (R20) — the member is pointed at harvest first. Stdout JSON.

import { rm, access } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readLockfile, removeEntry, localState } from "./lockfile.mjs";
import { allScopes, defaultContext } from "./scopes.mjs";
import { parseArgs } from "./install.mjs";
import { runCommand } from "./catalog.mjs";

const exists = (p) => access(p).then(() => true, () => false);

/** Remove one slug from every scope where it is installed. */
export async function uninstallOne({ slug, ctx, force }) {
  const removals = [];
  for (const root of allScopes(ctx)) {
    const lock = await readLockfile(root.lockfile);
    if (!(slug in lock.skills)) continue;
    const targetDir = join(root.skillsDir, slug);
    const state = await localState(targetDir, lock.skills[slug].computedHash);
    if (state === "modified" && !force) {
      removals.push({
        scope: root.scope,
        status: "blocked-modified",
        detail: "Locally modified — harvest it, or uninstall with --force to discard.",
      });
      continue;
    }
    if (await exists(targetDir)) await rm(targetDir, { recursive: true, force: true });
    await removeEntry(root.lockfile, slug);
    removals.push({ scope: root.scope, status: "removed" });
  }
  if (removals.length === 0) {
    return { slug, status: "error", detail: "not-installed: no lockfile entry in any scope." };
  }
  const blocked = removals.some((r) => r.status === "blocked-modified");
  return { slug, status: blocked ? "blocked-modified" : "removed", removals };
}

export async function uninstallSkills({ slugs, force = false, ctx = defaultContext() }) {
  const results = [];
  for (const slug of slugs) results.push(await uninstallOne({ slug, ctx, force }));
  return { ok: results.every((r) => r.status !== "error"), results };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.slugs.length === 0) {
    throw new Error("Usage: node uninstall.mjs --slugs=a,b [--force]");
  }
  return uninstallSkills(args);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCommand(main);
}
