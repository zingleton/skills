#!/usr/bin/env node
// guild-connect: profile.mjs — read/write the member's public profile
// (display name, links, description) through GET/POST /api/user-profile.
//
//   node profile.mjs get
//   node profile.mjs set '{"displayName":"Ada","websiteUrl":"https://ada.dev"}'
//
// `set` is read-merge-write: the current row is fetched first and only the
// provided keys change, so a partial edit never nulls the other fields. The
// picture always rides as {state:"unchanged"} — photos go through avatar.mjs.
// Stdout is machine-readable JSON; the "Acting as" banner goes to stderr.

import { pathToFileURL } from "node:url";
import { actingAs, getJson, parseJsonArg, postJson, runCommand } from "./api.mjs";

const SET_KEYS = ["displayName", "websiteUrl", "linkedinUrl", "youtubeUrl", "description"];

async function get() {
  await actingAs();
  return getJson("/api/user-profile");
}

async function set(rawJson) {
  const usage = `Usage: node profile.mjs set '{"displayName":"...", ...}' — keys: ${SET_KEYS.join(", ")}`;
  const edits = parseJsonArg(rawJson, usage);
  for (const key of Object.keys(edits)) {
    if (!SET_KEYS.includes(key)) {
      throw new Error(`Unknown profile field "${key}". ${usage}`);
    }
  }
  await actingAs();

  // Read-merge-write (SKILL.md hard rule): current row first, then overlay
  // ONLY the provided keys.
  const current = await getJson("/api/user-profile");
  const row = current.profile ?? {};
  const payload = {
    displayName: row.display_name ?? null,
    websiteUrl: row.website_url ?? null,
    linkedinUrl: row.linkedin_url ?? null,
    youtubeUrl: row.youtube_url ?? null,
    description: row.description ?? null,
    ...edits,
    picture: { state: "unchanged" }, // photos are avatar.mjs's job
  };
  return postJson("/api/user-profile", payload);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , command, arg] = process.argv;
  runCommand(() => {
    if (command === "get") return get();
    if (command === "set") return set(arg);
    throw new Error("Usage: node profile.mjs <get | set '<json>'>");
  });
}
