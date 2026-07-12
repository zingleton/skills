// guild-content: read one item (content-manage U6; R10). The read half of
// every edit: the returned `updatedAt` is the precondition edit.mjs requires.

import { pathToFileURL } from "node:url";
import { getJson, actingAs, runCommand } from "../../guild-connect/scripts/api.mjs";

const USAGE = "Usage: node get.mjs --id=<uuid>";

export function parseArgs(argv) {
  let id = null;
  for (const arg of argv) {
    if (arg.startsWith("--id=")) id = arg.slice(5);
    else throw new Error(`Unknown argument: ${arg}. ${USAGE}`);
  }
  if (!id) throw new Error(`--id is required. ${USAGE}`);
  return { id };
}

/** Fetch one item. deps.getJson injectable for tests. */
export async function getContent(id, deps = {}) {
  const get = deps.getJson ?? getJson;
  const body = await get(`/api/content/manage/${encodeURIComponent(id)}`);
  return body?.item ?? null;
}

async function main() {
  const { id } = parseArgs(process.argv.slice(2));
  await actingAs();
  const item = await getContent(id);
  return { ok: true, item };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCommand(main);
}
