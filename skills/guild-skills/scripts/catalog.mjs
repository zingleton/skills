// guild-skills: recommendations fetch (skills-delivery U5, R7/R9). Calls the
// app's bearer route through guild-connect's shared API client — the database is
// never a contract, only the pinned /api response shape is. Each entry carries
// the curator-owned pin (sourceRepo / sourcePath / pinnedCommit) the installer
// fetches, plus relevance annotations and advisory dependency notes.

import { pathToFileURL } from "node:url";
import { getJson, actingAs, runCommand } from "../../guild-connect/scripts/api.mjs";

export { actingAs, runCommand };

/** Fetch the member's recommendation list. deps.getJson injectable for tests. */
export async function fetchRecommendations(deps = {}) {
  const get = deps.getJson ?? getJson;
  const body = await get("/api/skills-catalog/recommendations");
  return Array.isArray(body?.skills) ? body.skills : [];
}

/** Index recommendation entries by slug for O(1) install lookup. */
export function indexBySlug(skills) {
  return new Map(skills.map((s) => [s.slug, s]));
}

// --- CLI: list the member's recommendations for the AI client to present -----

async function main() {
  await actingAs(); // connect-first preflight + "Acting as <email>" banner
  const skills = await fetchRecommendations();
  return { ok: true, count: skills.length, skills };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCommand(main);
}
