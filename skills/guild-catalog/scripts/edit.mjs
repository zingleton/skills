// guild-catalog: edit a catalog entry (content-manage U7; R11).
// Read-merge-write enforced locally: the API's updatedAt precondition is
// optional (grandfathered callers), but this skill always requires it — a
// patch without `updatedAt` from a fresh list.mjs read is refused before any
// network call, so concurrent curators can never silently revert each other.

import { pathToFileURL } from "node:url";
import {
  apiRequest,
  parseJsonArg,
  actingAs,
  runCommand,
} from "../../guild-connect/scripts/api.mjs";
import { isCommitSha } from "./add.mjs";

const USAGE =
  "Usage: node edit.mjs --id=<uuid> <patch.json | - | '{...}'> — patch carries " +
  'only the fields to change plus the REQUIRED "updatedAt" from list.mjs';

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

export function validatePatch(patch) {
  if (typeof patch.updatedAt !== "string" || patch.updatedAt === "") {
    throw new Error(
      `The patch must include "updatedAt" from a fresh list.mjs read — ` +
        `read, merge, then edit. ${USAGE}`,
    );
  }
  if (!Object.keys(patch).some((k) => k !== "updatedAt")) {
    throw new Error(`The patch has no fields to change. ${USAGE}`);
  }
  if (patch.pinnedCommit !== undefined && !isCommitSha(patch.pinnedCommit)) {
    throw new Error(`"pinnedCommit" must be a commit SHA, never a branch. ${USAGE}`);
  }
  if ("slug" in patch) {
    throw new Error(`"slug" is immutable (it is the installer's key). ${USAGE}`);
  }
  return patch;
}

/** PATCH the entry. deps.apiRequest injectable for tests. */
export async function editCatalogEntry(id, patch, deps = {}) {
  const request = deps.apiRequest ?? apiRequest;
  return request(`/api/skills-catalog/manage/${encodeURIComponent(id)}`, {
    method: "PATCH",
    json: patch,
  });
}

async function main() {
  const { id, raw } = parseArgs(process.argv.slice(2));
  if (!raw) throw new Error(USAGE);
  const patch = validatePatch(parseJsonArg(raw, USAGE));
  await actingAs();
  const body = await editCatalogEntry(id, patch);
  process.stderr.write("Edited. Store the new updatedAt for the next edit.\n");
  return { ok: true, id: body.id, slug: body.slug, updatedAt: body.updatedAt };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCommand(main);
}
