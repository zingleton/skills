#!/usr/bin/env node
// guild-skills: promote.mjs — move a project-scope skill to global scope
// (skills-delivery U5; R10). Claude Code only in v1 (Hermes installs stay
// profile-scoped — see Scope Boundaries). "Try before global": a member installs
// at project scope, then promotes deliberately.
//
//   node promote.mjs --slugs=a,b
//
// Moves the skill's files from <cwd>/.claude/skills to ~/.claude/skills and moves
// its lockfile entry (scope → global). Refuses when the slug already exists at
// global scope — uninstall or harvest the existing copy first. Stdout JSON.

import { rename, rm, cp, mkdir, access } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readLockfile, upsertEntry, removeEntry, hashSkillDir } from "./lockfile.mjs";
import { resolveScope, defaultContext } from "./scopes.mjs";
import { parseArgs } from "./install.mjs";
import { runCommand } from "./catalog.mjs";

const exists = (p) => access(p).then(() => true, () => false);

/** Move a directory, falling back to copy+remove across filesystems. */
async function moveDir(from, to) {
  await mkdir(join(to, ".."), { recursive: true });
  try {
    await rename(from, to);
  } catch (err) {
    if (err?.code !== "EXDEV") throw err;
    await cp(from, to, { recursive: true });
    await rm(from, { recursive: true, force: true });
  }
}

export async function promoteOne({ slug, ctx }) {
  const project = resolveScope("project", ctx);
  const global = resolveScope("global", ctx);

  const projectLock = await readLockfile(project.lockfile);
  const entry = projectLock.skills[slug];
  if (!entry) {
    return { slug, status: "error", detail: "not-installed: no project-scope entry to promote." };
  }

  const globalLock = await readLockfile(global.lockfile);
  if (slug in globalLock.skills) {
    return {
      slug,
      status: "error",
      detail: "already-global: uninstall or harvest the global copy before promoting.",
    };
  }

  const fromDir = join(project.skillsDir, slug);
  const toDir = join(global.skillsDir, slug);
  if (await exists(toDir)) {
    return { slug, status: "error", detail: "target-exists: a global skill folder already occupies this slug." };
  }
  await mkdir(global.skillsDir, { recursive: true });
  await moveDir(fromDir, toDir);

  const computedHash = await hashSkillDir(toDir);
  await upsertEntry(global.lockfile, slug, { ...entry, scope: "global", computedHash });
  await removeEntry(project.lockfile, slug);

  return { slug, status: "promoted", detail: "moved to global scope." };
}

export async function promoteSkills({ slugs, ctx = defaultContext() }) {
  const results = [];
  for (const slug of slugs) results.push(await promoteOne({ slug, ctx }));
  return { ok: results.every((r) => r.status !== "error"), results };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.slugs.length === 0) throw new Error("Usage: node promote.mjs --slugs=a,b");
  return promoteSkills(args);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCommand(main);
}
