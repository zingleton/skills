#!/usr/bin/env node
// guild-connect: intake.mjs — the intake interview's data legs.
//
//   node intake.mjs options [--role <role_key>] [--fresh]
//   node intake.mjs create '<payload-json>'
//
// `options` fetches the public catalog (GET /api/intake-options). With
// --role, tasks are filtered to scope ∈ {universal, <role>} and capped at 10
// — mirroring what the web intake shows (lib/intake/tasks.ts; the API returns
// tasks presentation-ordered, so the first 10 after filtering ARE the cap).
// --fresh adds a cache-busting query param (the route serves long-lived
// Cache-Control) — use it when recovering from a catalog_changed rejection.
//
// `create` POSTs the confirmed interview payload to /api/submissions:
//   { role_key, email_cadence, deliverable_interests: [...],
//     task_interests: [...], top_deliverable_type_id?, top_task_id?,
//     pain_point? }   (no referral field exists on this surface)
// On 409 already_has_submission the printed JSON carries a machine-readable
// hint to switch to edit mode (interests.mjs); on 422 catalog_changed, a hint
// to re-fetch options and re-confirm.

import { pathToFileURL } from "node:url";
import { actingAs, getJson, parseJsonArg, postJson, runCommand } from "./api.mjs";

const TASK_CAP = 10; // INTAKE_LIST_CAP — what one respondent is shown

async function options(roleKey, fresh) {
  await actingAs();
  // --fresh: bust intermediary HTTP caches (the route sends a long max-age)
  // so a catalog_changed recovery re-reads the CURRENT catalog.
  const path = fresh ? `/api/intake-options?t=${Date.now()}` : "/api/intake-options";
  const catalog = await getJson(path);
  if (!roleKey) return catalog;
  return {
    ...catalog,
    tasks: catalog.tasks
      .filter((t) => t.scope === "universal" || t.scope === roleKey)
      .slice(0, TASK_CAP),
  };
}

async function create(rawJson) {
  const usage =
    "Usage: node intake.mjs create '{\"role_key\":\"...\",\"email_cadence\":\"weekly\",\"deliverable_interests\":[...],\"task_interests\":[...]}'";
  const payload = parseJsonArg(rawJson, usage);
  await actingAs();

  // The API schema requires the optional fields as explicit nulls.
  const body = {
    top_deliverable_type_id: null,
    top_task_id: null,
    pain_point: null,
    ...payload,
  };
  return postJson("/api/submissions", body);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const command = args[0];
  runCommand(() => {
    if (command === "options") {
      const fresh = args.includes("--fresh");
      const roleFlag = args.indexOf("--role");
      const roleKey =
        roleFlag !== -1 && args[roleFlag + 1] !== "--fresh" ? args[roleFlag + 1] : undefined;
      if (roleFlag !== -1 && !roleKey) {
        throw new Error("Usage: node intake.mjs options [--role <role_key>] [--fresh]");
      }
      return options(roleKey, fresh);
    }
    if (command === "create") return create(args[1]);
    throw new Error(
      "Usage: node intake.mjs <options [--role <key>] [--fresh] | create '<json>'>",
    );
  });
}
