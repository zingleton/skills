// guild-catalog: move an entry's pin and nothing else (content-manage U7;
// R11). Sends ONLY {pinnedCommit, updatedAt} — the manage API replaces
// role/task recommendation arrays only when present, so a re-pin never
// touches targeting. Pin what you reviewed: the SHA rule is enforced locally.

import { pathToFileURL } from "node:url";
import { actingAs, runCommand } from "../../guild-connect/scripts/api.mjs";
import { isCommitSha } from "./add.mjs";
import { editCatalogEntry } from "./edit.mjs";

const USAGE =
  "Usage: node repin.mjs --id=<uuid> --commit=<sha> --updated-at=<ts from list.mjs>";

export function parseArgs(argv) {
  let id = null;
  let commit = null;
  let updatedAt = null;
  for (const arg of argv) {
    if (arg.startsWith("--id=")) id = arg.slice(5);
    else if (arg.startsWith("--commit=")) commit = arg.slice(9);
    else if (arg.startsWith("--updated-at=")) updatedAt = arg.slice(13);
    else throw new Error(`Unknown argument: ${arg}. ${USAGE}`);
  }
  if (!id) throw new Error(`--id is required. ${USAGE}`);
  if (!isCommitSha(commit)) {
    throw new Error(
      `--commit must be a commit SHA (7-64 hex chars), never a branch. ${USAGE}`,
    );
  }
  if (!updatedAt) {
    throw new Error(
      `--updated-at is required — read it from list.mjs first. ${USAGE}`,
    );
  }
  return { id, commit, updatedAt };
}

/** The exact two-field patch a re-pin sends. */
export function repinPatch(commit, updatedAt) {
  return { pinnedCommit: commit, updatedAt };
}

async function main() {
  const { id, commit, updatedAt } = parseArgs(process.argv.slice(2));
  await actingAs();
  const body = await editCatalogEntry(id, repinPatch(commit, updatedAt));
  process.stderr.write("Re-pinned. Installs and updates now fetch this commit.\n");
  return { ok: true, id: body.id, slug: body.slug, updatedAt: body.updatedAt };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCommand(main);
}
