// guild-content: list first-party items (content-manage U6; R10). Calls the
// guide/admin manage route through guild-connect's shared API client. Also
// the check-before-retry tool: after a post.mjs timeout, `--mine` shows
// whether the post landed before any retry.

import { pathToFileURL } from "node:url";
import { getJson, actingAs, runCommand } from "../../guild-connect/scripts/api.mjs";

const USAGE =
  "Usage: node list.mjs [--status=published|retracted] [--mine] [--limit=N]";

/** Parse CLI flags into query params; throws on anything unrecognized. */
export function parseArgs(argv) {
  const params = {};
  for (const arg of argv) {
    if (arg === "--mine") params.mine = "true";
    else if (arg.startsWith("--status=")) params.status = arg.slice(9);
    else if (arg.startsWith("--limit=")) params.limit = arg.slice(8);
    else throw new Error(`Unknown argument: ${arg}. ${USAGE}`);
  }
  if (params.status && !["published", "retracted"].includes(params.status)) {
    throw new Error(`--status must be published or retracted. ${USAGE}`);
  }
  return params;
}

/** Fetch the item list. deps.getJson injectable for tests. */
export async function listContent(params = {}, deps = {}) {
  const get = deps.getJson ?? getJson;
  const qs = new URLSearchParams(params).toString();
  const body = await get(`/api/content/manage${qs ? `?${qs}` : ""}`);
  return Array.isArray(body?.items) ? body.items : [];
}

async function main() {
  const params = parseArgs(process.argv.slice(2));
  await actingAs();
  const items = await listContent(params);
  return { ok: true, count: items.length, items };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCommand(main);
}
