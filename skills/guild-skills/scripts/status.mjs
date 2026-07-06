#!/usr/bin/env node
// guild-skills: status.mjs — list installed skills across all scopes with their
// local-modification state (skills-delivery U5; R11/R20 signal).
//
//   node status.mjs
//
// Enumerates the project + global (+ profile) lockfiles, and for each entry
// reports its scope, source pin, fork flag, and whether the on-disk copy is
// clean, modified, or missing. Read-only; no network. Stdout JSON.

import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readLockfile, localState } from "./lockfile.mjs";
import { allScopes, defaultContext } from "./scopes.mjs";
import { runCommand } from "./catalog.mjs";

export async function statusReport({ ctx = defaultContext() } = {}) {
  const skills = [];
  for (const root of allScopes(ctx)) {
    const lock = await readLockfile(root.lockfile);
    for (const [slug, entry] of Object.entries(lock.skills)) {
      const state = await localState(join(root.skillsDir, slug), entry.computedHash);
      skills.push({
        slug,
        scope: root.scope,
        source: entry.source,
        pinnedCommit: entry.pinnedCommit,
        fork: entry.fork === true,
        originalSource: entry.originalSource ?? null,
        state,
      });
    }
  }
  skills.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  return { ok: true, count: skills.length, skills };
}

async function main() {
  return statusReport();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCommand(main);
}
