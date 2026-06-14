#!/usr/bin/env node
// guild-connect: interests.mjs — read/edit the member's intake interests
// (GET /api/profile → POST /api/profile).
//
//   node interests.mjs get
//   node interests.mjs set '{"email_cadence":"daily",
//                            "task_interests":[{"task_id":"<uuid>","interested":true}]}'
//
// `set` enforces the MANDATORY read-merge-write contract (KTD5, SKILL.md hard
// rule): GET the current intake, merge only the changed fields, POST the
// WHOLE payload back. role_key is always echoed from the server — it can
// never be changed here (role is display-only after intake; the server
// rejects nothing, so the discipline lives in this client). Interest arrays
// merge per-id: provided entries replace matching ids, everything else is
// preserved, new ids are appended.

import { pathToFileURL } from "node:url";
import { actingAs, getJson, parseJsonArg, postJson, runCommand } from "./api.mjs";

const SET_KEYS = [
  "email_cadence",
  "top_deliverable_type_id",
  "top_task_id",
  "pain_point",
  "deliverable_interests",
  "task_interests",
];

/**
 * Usage-level validation of an interest-edit array BEFORE the merge: each
 * entry must carry a non-empty string id and a real boolean `interested` —
 * otherwise a typo'd entry would silently merge as interested:false.
 */
function validateInterestEdits(edits, key, idKey, usage) {
  if (edits === undefined) return;
  if (!Array.isArray(edits)) {
    throw new Error(`"${key}" must be an array. ${usage}`);
  }
  for (const e of edits) {
    if (
      e === null ||
      typeof e !== "object" ||
      typeof e[idKey] !== "string" ||
      e[idKey] === "" ||
      typeof e.interested !== "boolean"
    ) {
      throw new Error(
        `Each "${key}" entry needs a "${idKey}" string and a boolean "interested". ${usage}`,
      );
    }
  }
}

function mergeById(existing, edits, idKey) {
  if (!Array.isArray(edits)) return existing;
  const merged = existing.map((row) => {
    const override = edits.find((e) => e?.[idKey] === row[idKey]);
    return override ? { ...row, interested: override.interested === true } : row;
  });
  for (const e of edits) {
    if (e?.[idKey] && !existing.some((row) => row[idKey] === e[idKey])) {
      merged.push({ [idKey]: e[idKey], interested: e.interested === true });
    }
  }
  return merged;
}

async function get() {
  await actingAs();
  return getJson("/api/profile");
}

async function set(rawJson) {
  const usage = `Usage: node interests.mjs set '<json>' — keys: ${SET_KEYS.join(", ")}`;
  const edits = parseJsonArg(rawJson, usage);
  if ("role_key" in edits) {
    throw new Error(
      "role_key cannot be changed — it is set at intake and echoed back on every save.",
    );
  }
  for (const key of Object.keys(edits)) {
    if (!SET_KEYS.includes(key)) throw new Error(`Unknown interests field "${key}". ${usage}`);
  }
  validateInterestEdits(
    edits.deliverable_interests,
    "deliverable_interests",
    "deliverable_type_id",
    usage,
  );
  validateInterestEdits(edits.task_interests, "task_interests", "task_id", usage);
  await actingAs();

  // READ: the current intake is the base of every write.
  const current = await getJson("/api/profile");
  if (!current.intake) {
    throw new Error(
      "No intake submission exists yet — run the intake first (intake.mjs create).",
    );
  }
  const base = current.intake;

  // MERGE: scalars replace, interest arrays merge per-id.
  const payload = {
    role_key: base.role_key, // echoed, never changed
    email_cadence: edits.email_cadence ?? base.email_cadence,
    top_deliverable_type_id:
      "top_deliverable_type_id" in edits
        ? edits.top_deliverable_type_id
        : base.top_deliverable_type_id,
    top_task_id: "top_task_id" in edits ? edits.top_task_id : base.top_task_id,
    pain_point: "pain_point" in edits ? edits.pain_point : base.pain_point,
    deliverable_interests: mergeById(
      base.deliverable_interests,
      edits.deliverable_interests,
      "deliverable_type_id",
    ),
    task_interests: mergeById(base.task_interests, edits.task_interests, "task_id"),
  };

  // WRITE: the whole payload, every time.
  return postJson("/api/profile", payload);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , command, arg] = process.argv;
  runCommand(() => {
    if (command === "get") return get();
    if (command === "set") return set(arg);
    throw new Error("Usage: node interests.mjs <get | set '<json>'>");
  });
}
