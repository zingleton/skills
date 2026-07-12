// guild-catalog: create a catalog entry (content-manage U7; R11). The pin is
// validated locally — always a commit SHA, never a branch name — so a bad pin
// never costs a round-trip (and never lands in the catalog: the API enforces
// the same rule). A duplicate-source 409 carries the existing entry's
// identity (api.mjs `existing` passthrough) — edit that entry instead.

import { pathToFileURL } from "node:url";
import {
  postJson,
  parseJsonArg,
  actingAs,
  runCommand,
} from "../../guild-connect/scripts/api.mjs";

const USAGE =
  "Usage: node add.mjs <payload.json | - | '{...}'> — payload " +
  '{"slug","name","sourceRepo":"owner/repo","sourcePath","pinnedCommit":"<sha>",...}';

/** A pin is a 7–64 char lowercase hex git SHA (mirrors the API rule). */
export function isCommitSha(value) {
  return typeof value === "string" && /^[0-9a-f]{7,64}$/.test(value);
}

/** Local shape check; rejects a branch-name pin before any network call. */
export function validatePayload(payload) {
  for (const field of ["slug", "name", "sourceRepo", "sourcePath", "pinnedCommit"]) {
    if (typeof payload[field] !== "string" || payload[field] === "") {
      throw new Error(`Payload needs a non-empty "${field}". ${USAGE}`);
    }
  }
  if (!isCommitSha(payload.pinnedCommit)) {
    throw new Error(
      `"pinnedCommit" must be a commit SHA (7-64 hex chars), never a branch ` +
        `name — resolve it with git ls-remote/rev-parse first. ${USAGE}`,
    );
  }
  return payload;
}

/** POST the entry. deps.postJson injectable for tests. */
export async function addCatalogEntry(payload, deps = {}) {
  const post = deps.postJson ?? postJson;
  return post("/api/skills-catalog/manage", payload);
}

async function main() {
  const raw = process.argv[2];
  if (!raw) throw new Error(USAGE);
  const payload = validatePayload(parseJsonArg(raw, USAGE));
  await actingAs();
  const body = await addCatalogEntry(payload);
  const strength = payload.strength ?? 0;
  process.stderr.write(
    strength === 0
      ? "Created hidden (strength 0). Verify an install, then raise the strength with edit.mjs.\n"
      : `Created at strength ${strength} — visible to members now.\n`,
  );
  return { ok: true, id: body.id, slug: body.slug, updatedAt: body.updatedAt };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCommand(main);
}
