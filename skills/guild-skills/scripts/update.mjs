#!/usr/bin/env node
// guild-skills: update.mjs — member-triggered update against current catalog
// pins (skills-delivery U6; R12/R16/R17/R20).
//
//   node update.mjs                          # report only (no mutation)
//   node update.mjs --apply --slugs=a,b [--pins=a=<sha>,b=<sha>]
//
// Report enumerates every scope's lockfile and resolves each installed skill
// against the catalog:
//   fork-skipped     — a harvested fork; never updated (optional "upstream moved")
//   catalog-removed  — no catalog entry; files kept, informational
//   up-to-date       — catalog pin equals the installed pin
//   update-available — pin moved and the local copy is clean → offer re-pin
//   blocked-modified — pin moved but the local copy is modified → harvest/discard
//
// Apply installs the exact pin the member approved. It RE-CHECKS the catalog at
// apply time: if `--pins` records the pin the member saw and a curator re-pinned
// since, that skill aborts and re-reports rather than installing either pin. A
// fetch failure at apply surfaces as source-unreachable (never "up to date").
// Stdout JSON; human copy to stderr.

import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readLockfile, localState } from "./lockfile.mjs";
import { allScopes, defaultContext } from "./scopes.mjs";
import { installOne } from "./install.mjs";
import { fetchRecommendations, indexBySlug, actingAs, runCommand } from "./catalog.mjs";

async function resolveOne({ slug, entry, root, catalogEntry }) {
  const base = { slug, scope: root.scope, fromPin: entry.pinnedCommit };
  if (entry.fork === true) {
    const upstreamMoved = !!catalogEntry && catalogEntry.pinnedCommit !== entry.pinnedCommit;
    return { ...base, outcome: "fork-skipped", upstreamMoved, toPin: catalogEntry?.pinnedCommit ?? null };
  }
  if (!catalogEntry) return { ...base, outcome: "catalog-removed" };
  if (catalogEntry.pinnedCommit === entry.pinnedCommit) return { ...base, outcome: "up-to-date" };
  const state = await localState(join(root.skillsDir, slug), entry.computedHash);
  if (state === "modified") return { ...base, outcome: "blocked-modified", toPin: catalogEntry.pinnedCommit };
  return { ...base, outcome: "update-available", toPin: catalogEntry.pinnedCommit };
}

/** Report-only pass across every scope's lockfile. */
export async function resolveUpdates({ ctx = defaultContext(), deps = {} } = {}) {
  const catalog = deps.fetchCatalog ? await deps.fetchCatalog() : await fetchRecommendations();
  const bySlug = indexBySlug(catalog);
  const updates = [];
  for (const root of allScopes(ctx)) {
    const lock = await readLockfile(root.lockfile);
    for (const [slug, entry] of Object.entries(lock.skills)) {
      updates.push(await resolveOne({ slug, entry, root, catalogEntry: bySlug.get(slug) }));
    }
  }
  return { ok: true, updates };
}

/**
 * Apply approved updates. `expectedPins` (slug → the pin the member saw in the
 * report) enables the re-pin-race guard: if the catalog moved again, that skill
 * aborts with a fresh report instead of installing.
 */
export async function applyUpdates({ slugs, expectedPins = {}, ctx = defaultContext(), deps = {} }) {
  const catalog = deps.fetchCatalog ? await deps.fetchCatalog() : await fetchRecommendations();
  const bySlug = indexBySlug(catalog);
  const requested = new Set(slugs);

  const results = [];
  for (const root of allScopes(ctx)) {
    const lock = await readLockfile(root.lockfile);
    for (const [slug, entry] of Object.entries(lock.skills)) {
      if (!requested.has(slug)) continue;
      if (entry.fork === true) {
        results.push({ slug, scope: root.scope, status: "skipped", detail: "fork — not updated." });
        continue;
      }
      const catalogEntry = bySlug.get(slug);
      if (!catalogEntry) {
        results.push({ slug, scope: root.scope, status: "skipped", detail: "catalog-removed." });
        continue;
      }
      // Re-pin race: the member approved a pin that has since moved again.
      if (expectedPins[slug] && catalogEntry.pinnedCommit !== expectedPins[slug]) {
        results.push({
          slug,
          scope: root.scope,
          status: "re-pinned-aborted",
          detail: "The curator re-pinned this skill since your report — re-run update to review.",
          sawPin: expectedPins[slug],
          nowPin: catalogEntry.pinnedCommit,
        });
        continue;
      }
      // Install the current pin into this scope root. installOne enforces the
      // R20 modified guard and reports source-unreachable on a fetch failure.
      const r = await installOne({ entry: catalogEntry, scope: root.scope, root, force: false }, deps);
      results.push({ slug, scope: root.scope, status: r.status, detail: r.detail });
    }
  }
  return { ok: results.every((r) => r.status !== "error"), results };
}

// --- CLI --------------------------------------------------------------------

export function parseUpdateArgs(argv) {
  const out = { apply: false, slugs: [], expectedPins: {} };
  for (const a of argv) {
    if (a === "--apply") out.apply = true;
    else if (a.startsWith("--slugs=")) {
      out.slugs = a.slice(8).split(",").map((s) => s.trim()).filter(Boolean);
    } else if (a.startsWith("--pins=")) {
      for (const pair of a.slice(7).split(",")) {
        const [slug, pin] = pair.split("=");
        if (slug && pin) out.expectedPins[slug.trim()] = pin.trim();
      }
    }
  }
  return out;
}

async function main() {
  const args = parseUpdateArgs(process.argv.slice(2));
  await actingAs(); // connect-first preflight + banner
  if (!args.apply) return resolveUpdates();
  if (args.slugs.length === 0) {
    throw new Error("Usage: node update.mjs --apply --slugs=a,b [--pins=a=<sha>,b=<sha>]");
  }
  return applyUpdates(args);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCommand(main);
}
