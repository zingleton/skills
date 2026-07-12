// guild-content: partial edit of a published item (content-manage U6; R10).
// Read-merge-write is enforced locally: a patch without the item's current
// `updatedAt` is refused before any network call, forcing the get.mjs read
// step. The server 409s a stale value (someone else edited) — re-read,
// re-merge, retry with the fresh updatedAt.

import { pathToFileURL } from "node:url";
import {
  apiRequest,
  parseJsonArg,
  actingAs,
  runCommand,
} from "../../guild-connect/scripts/api.mjs";

const USAGE =
  "Usage: node edit.mjs --id=<uuid> <patch.json | - | '{...}'> — patch carries " +
  'only the fields to change plus the REQUIRED "updatedAt" from get.mjs';

export function parseArgs(argv) {
  let id = null;
  let raw = null;
  for (const arg of argv) {
    if (arg.startsWith("--id=")) id = arg.slice(5);
    else if (raw === null) raw = arg;
    else throw new Error(`Unexpected argument: ${arg}. ${USAGE}`);
  }
  if (!id) throw new Error(`--id is required. ${USAGE}`);
  return { id, raw };
}

/** Refuse locally without the precondition — the read step is mandatory. */
export function validatePatch(patch) {
  if (typeof patch.updatedAt !== "string" || patch.updatedAt === "") {
    throw new Error(
      `The patch must include "updatedAt" from a fresh get.mjs read — ` +
        `read, merge, then edit. ${USAGE}`,
    );
  }
  if (!Object.keys(patch).some((k) => k !== "updatedAt")) {
    throw new Error(`The patch has no fields to change. ${USAGE}`);
  }
  return patch;
}

/** PATCH the item. deps.apiRequest injectable for tests. */
export async function editContent(id, patch, deps = {}) {
  const request = deps.apiRequest ?? apiRequest;
  const body = await request(`/api/content/manage/${encodeURIComponent(id)}`, {
    method: "PATCH",
    json: patch,
  });
  return body?.item ?? null;
}

async function main() {
  const { id, raw } = parseArgs(process.argv.slice(2));
  if (!raw) throw new Error(USAGE);
  const patch = validatePatch(parseJsonArg(raw, USAGE));
  await actingAs();
  const item = await editContent(id, patch);
  process.stderr.write("Edited. Store the new updatedAt for the next edit.\n");
  return { ok: true, item };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCommand(main);
}
