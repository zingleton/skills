// guild-catalog: delete a catalog entry (content-manage U7; R11). Removal
// stops new installs and updates (members keep installed copies), and there
// is no undo — so the human-confirmation gate is enforced in code: without
// --confirm this refuses before credentials or network are touched. Prefer
// hiding (edit.mjs strength 0) when the entry might come back.

import { pathToFileURL } from "node:url";
import {
  apiRequest,
  actingAs,
  runCommand,
} from "../../guild-connect/scripts/api.mjs";

const USAGE = "Usage: node remove.mjs --id=<uuid> --confirm";

const CONFIRM_MSG =
  "Refusing to remove without --confirm. Echo the entry's slug and name to the " +
  "guide, get an explicit yes (or hide it with strength 0 instead), then re-run " +
  "with --confirm.";

export function parseArgs(argv) {
  let id = null;
  let confirm = false;
  for (const arg of argv) {
    if (arg === "--confirm") confirm = true;
    else if (arg.startsWith("--id=")) id = arg.slice(5);
    else throw new Error(`Unknown argument: ${arg}. ${USAGE}`);
  }
  if (!id) throw new Error(`--id is required. ${USAGE}`);
  return { id, confirm };
}

/** DELETE the entry. deps.apiRequest injectable for tests. */
export async function removeCatalogEntry(id, deps = {}) {
  const request = deps.apiRequest ?? apiRequest;
  return request(`/api/skills-catalog/manage/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

async function main() {
  const { id, confirm } = parseArgs(process.argv.slice(2));
  if (!confirm) throw new Error(CONFIRM_MSG);
  await actingAs();
  await removeCatalogEntry(id);
  process.stderr.write(
    "Removed. Members with it installed keep their copy; new installs stop.\n",
  );
  return { ok: true, id };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCommand(main);
}
