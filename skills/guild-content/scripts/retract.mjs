// guild-content: retract a published item (content-manage U6; R10).
// Retraction is PERMANENT in v1 — no restore exists — so the confirmation
// gate is enforced in code: without --confirm this refuses before any
// network call. The response is a snapshot of what was just retracted
// (id, title, publishedAt, status) — always show it to the guide so a
// mistaken retract is immediately visible.

import { pathToFileURL } from "node:url";
import {
  apiRequest,
  actingAs,
  runCommand,
} from "../../guild-connect/scripts/api.mjs";

const USAGE = "Usage: node retract.mjs --id=<uuid> --confirm";

const CONFIRM_MSG =
  "Refusing to retract without --confirm. Retraction is permanent — echo the " +
  "item's title and id to the guide, get an explicit yes, then re-run with --confirm.";

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

/** DELETE the item. deps.apiRequest injectable for tests. */
export async function retractContent(id, deps = {}) {
  const request = deps.apiRequest ?? apiRequest;
  const body = await request(`/api/content/manage/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  return body?.item ?? null;
}

async function main() {
  const { id, confirm } = parseArgs(process.argv.slice(2));
  if (!confirm) throw new Error(CONFIRM_MSG);
  await actingAs();
  const item = await retractContent(id);
  process.stderr.write(
    "Retracted permanently. Verify the snapshot below is the intended item.\n",
  );
  return { ok: true, item };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCommand(main);
}
