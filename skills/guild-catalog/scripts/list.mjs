// guild-catalog: full catalog list including hidden entries (content-manage
// U7; R11). The curation read: unlike the public /api/skills-catalog and the
// member recommendations route, this returns strength-0 entries and each
// entry's `id` + `updatedAt` (the edit/repin precondition).

import { pathToFileURL } from "node:url";
import { getJson, actingAs, runCommand } from "../../guild-connect/scripts/api.mjs";

/** Fetch the full catalog. deps.getJson injectable for tests. */
export async function listCatalog(deps = {}) {
  const get = deps.getJson ?? getJson;
  const body = await get("/api/skills-catalog/manage");
  return Array.isArray(body?.skills) ? body.skills : [];
}

async function main() {
  await actingAs();
  const skills = await listCatalog();
  return { ok: true, count: skills.length, skills };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCommand(main);
}
