#!/usr/bin/env node
// guild-connect: doctor.mjs — preflight environment check (U1).
//
// Runs BEFORE connect / git-setup / repo-setup: verifies the local toolchain
// (Node >= 18, git on PATH) and stops with copy-pasteable fixes so a later step
// never fails cryptically. This is the one guild script that is safe to run on a
// machine with nothing set up yet — no credential, no network, no API call.
//
//   node doctor.mjs
//
// Stdout is machine-readable JSON: { ok, checks: [{ name, ok, fix }] }.
// Stderr carries the fix line for each failing check. Exit code is 0 when every
// check passes, 1 when any fails.
//
// Kept to an OLD Node syntax baseline on purpose: a too-old Node must still be
// able to PARSE and RUN this file so it prints a friendly "upgrade Node" message
// instead of crashing with a cryptic SyntaxError — the exact failure the doctor
// exists to replace. Do not introduce syntax newer than the MIN_NODE_MAJOR-minus
// baseline here (no top-level await, no recent-only syntax).
//
// Plugin freshness is intentionally NOT checked here: pre-connect there is no
// credential and no server round-trip, and the existing `stale_skill` signal
// only detects key-migration breakage on the connect `send` path — it is not a
// version check. Version-drift detection is out of scope this release.

import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

export const MIN_NODE_MAJOR = 18;

/** Parse a Node version string ("v18.19.0" / "18.19.0") to its major int; null when unparseable. */
export function parseNodeVersion(str) {
  const m = /v?(\d+)\./.exec(String(str == null ? "" : str).trim());
  return m ? Number(m[1]) : null;
}

/**
 * Pure check: given the detected Node major and whether git is present, build
 * the structured result. `fix` strings are copy-pasteable guidance and are null
 * when the check passed. Result `ok` is true only when every check is ok.
 */
export function checkEnv(input) {
  const nodeVersion = input ? input.nodeVersion : null;
  const gitExists = input ? input.gitExists : false;
  const checks = [];

  const nodeOk = typeof nodeVersion === "number" && nodeVersion >= MIN_NODE_MAJOR;
  checks.push({
    name: "node",
    ok: nodeOk,
    fix: nodeOk
      ? null
      : "Node " +
        MIN_NODE_MAJOR +
        "+ is required (found " +
        (nodeVersion == null ? "an unrecognized version" : "v" + nodeVersion) +
        "). Install the latest LTS from https://nodejs.org , reopen your terminal, and re-run.",
  });

  const gitOk = !!gitExists;
  checks.push({
    name: "git",
    ok: gitOk,
    fix: gitOk
      ? null
      : "git was not found on your PATH. Install it from https://git-scm.com/downloads , reopen your terminal, and re-run.",
  });

  let ok = true;
  for (let i = 0; i < checks.length; i++) {
    if (!checks[i].ok) ok = false;
  }
  return { ok: ok, checks: checks };
}

// --- CLI wiring (deps injectable for tests via runDoctor) -------------------

/** Resolve true when `git --version` spawns and exits 0; false on ENOENT or non-zero. */
function gitOnPath() {
  return new Promise(function (resolve) {
    let child;
    try {
      child = spawn("git", ["--version"], { stdio: "ignore" });
    } catch (e) {
      resolve(false);
      return;
    }
    child.on("error", function () {
      resolve(false);
    });
    child.on("close", function (code) {
      resolve(code === 0);
    });
  });
}

/**
 * Orchestrator with deps injected for tests:
 *   deps.nodeVersion  → detected Node major (number) or null
 *   deps.gitExists()  → Promise<boolean>
 */
export async function runDoctor(deps) {
  const gitExists = await deps.gitExists();
  return checkEnv({ nodeVersion: deps.nodeVersion, gitExists: gitExists });
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  runDoctor({
    nodeVersion: parseNodeVersion(process.version),
    gitExists: gitOnPath,
  }).then(
    function (result) {
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      for (let i = 0; i < result.checks.length; i++) {
        const c = result.checks[i];
        if (!c.ok && c.fix) process.stderr.write(c.fix + "\n");
      }
      process.exit(result.ok ? 0 : 1);
    },
    function (err) {
      process.stderr.write((err && err.message ? err.message : "doctor failed unexpectedly.") + "\n");
      process.exit(1);
    },
  );
}
