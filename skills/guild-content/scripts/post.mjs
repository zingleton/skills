// guild-content: create + publish a first-party item (content-manage U6;
// R10). Posts go LIVE immediately (member /news page + digest emails), so the
// human-confirmation gate is enforced in code, not just prose: without
// --confirm this script refuses before touching the network. The model shows
// the guide the exact payload, gets a yes, then re-runs with --confirm.
//
// Retry discipline: a duplicate-title 409 carries the existing item's id
// (`existing.id`) — surface it and STOP; never loop the create. After a
// timeout, check with `list.mjs --mine` before any retry.

import { pathToFileURL } from "node:url";
import {
  postJson,
  parseJsonArg,
  actingAs,
  runCommand,
} from "../../guild-connect/scripts/api.mjs";

const USAGE =
  "Usage: node post.mjs <payload.json | - | '{...}'> --confirm — payload " +
  '{"title","body","link"?,"kind"?,"tags":[{"role_key"|"task_id"|"deliverable_type_id"}]}';

const CONFIRM_MSG =
  "Refusing to post without --confirm. Posts publish immediately to members — " +
  "show the guide the exact title, body, link, kind, and tags, get an explicit " +
  "yes, then re-run with --confirm.";

export function parseArgs(argv) {
  let confirm = false;
  let raw = null;
  for (const arg of argv) {
    if (arg === "--confirm") confirm = true;
    else if (raw === null) raw = arg;
    else throw new Error(`Unexpected argument: ${arg}. ${USAGE}`);
  }
  return { confirm, raw };
}

/** Local shape check so an obviously bad payload never costs a round-trip. */
export function validatePayload(payload) {
  if (typeof payload.title !== "string" || payload.title.trim() === "") {
    throw new Error(`Payload needs a non-empty "title". ${USAGE}`);
  }
  if (typeof payload.body !== "string" || payload.body.trim() === "") {
    throw new Error(`Payload needs a non-empty "body". ${USAGE}`);
  }
  if (!Array.isArray(payload.tags) || payload.tags.length === 0) {
    throw new Error(`Payload needs at least one tag. ${USAGE}`);
  }
  return payload;
}

/** POST the payload. deps.postJson injectable for tests. No retries here. */
export async function postContent(payload, deps = {}) {
  const post = deps.postJson ?? postJson;
  const body = await post("/api/content/manage", payload);
  return body?.item ?? null;
}

async function main() {
  const { confirm, raw } = parseArgs(process.argv.slice(2));
  if (!raw) throw new Error(USAGE);
  if (!confirm) throw new Error(CONFIRM_MSG);
  const payload = validatePayload(parseJsonArg(raw, USAGE));
  await actingAs();
  const item = await postContent(payload);
  process.stderr.write("Published. It is live on /news now.\n");
  return { ok: true, item };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCommand(main);
}
