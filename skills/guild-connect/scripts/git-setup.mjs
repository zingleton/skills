#!/usr/bin/env node
// guild-connect: git-setup.mjs (forgejo U7; R14/R15/R17/R21/R25; F1/F5).
//
// Installs a durable Forgejo git credential into the local OS credential store
// with one command, so plain `git clone/pull/push` — and any local agent that
// shells out to git (Codex, Claude Code) — works against role plugin repos and
// the member's personal repo without further sign-in.
//
// Flow:
//   1. call POST /api/account/git-access with the stored Guild credential
//      (api.mjs → the durable Guild bearer token); the response carries the
//      Forgejo host, the member's forge username, and a freshly minted,
//      bounded-lifetime, per-device git token (returned ONCE),
//   2. confirm git is on PATH and a credential helper is configured for the
//      host (configure the platform default when none is),
//   3. pipe the token into `git credential approve` over stdin so it lands in
//      the OS store (GCM / osxkeychain / wincred / libsecret),
//   4. verify with `git ls-remote` against the member's personal repo,
//   5. print clone guidance — NEVER the token.
//
// This is net-new ground: the other guild scripts never shell out to git, so
// every git failure mode (no git, no helper, helper rejects, verify fails) is
// handled explicitly here, not inherited. Re-running RE-INSTALLS (no retry
// loop). The Guild credential is reused via api.mjs — never copied or printed.
//
// Hard rules honored: the git token is never written to stdout/stderr/logs; the
// Guild bearer token and raw API/GoTrue bodies are never echoed (api.mjs
// redacts; this module quotes only its own copy).

import { spawn } from "node:child_process";
import { hostname } from "node:os";
import { pathToFileURL } from "node:url";
import { actingAs, postJson, runCommand } from "./api.mjs";

// The member's personal repo name — mirrors lib/config FORGEJO_PERSONAL_REPO_NAME
// (the route doesn't echo it; the convention is fixed).
const PERSONAL_REPO = "personal";

/** A locally classified git-setup failure whose message is safe to print. */
export class GitSetupError extends Error {
  constructor(message) {
    super(message);
    this.name = "GitSetupError";
  }
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

/** Just the hostname for the `host=` credential field — accepts a full URL or bare host. */
export function parseForgejoHost(hostOrUrl) {
  const value = String(hostOrUrl ?? "").trim();
  if (!value) return "";
  try {
    return new URL(value).host;
  } catch {
    return value.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  }
}

/**
 * The EXACT stdin payload `git credential approve` expects, host-scoped so the
 * token is stored only for the Forgejo host (gitcredentials(7) format). The
 * trailing blank line terminates the record.
 */
export function gitCredentialInput({ host, username, token }) {
  return `protocol=https\nhost=${host}\nusername=${username}\npassword=${token}\n\n`;
}

/**
 * Pick the credential helper for the platform. Linux falls back to plaintext
 * `store` (with a warning) only when no secret service is available (R-OQ1).
 */
export function chooseHelper(platform, { hasSecretService } = {}) {
  if (platform === "win32") return { helper: "manager", plaintextWarning: false };
  if (platform === "darwin") return { helper: "osxkeychain", plaintextWarning: false };
  if (platform === "linux") {
    return hasSecretService
      ? { helper: "libsecret", plaintextWarning: false }
      : { helper: "store", plaintextWarning: true };
  }
  // Unknown platform: safest portable default is plaintext store, with warning.
  return { helper: "store", plaintextWarning: true };
}

/** Derive a stable per-device label from the hostname so a re-run REPLACES this device's token (KTD6). */
export function deviceLabel(name) {
  const slug = String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || "default";
}

// ---------------------------------------------------------------------------
// Orchestrator (deps injected for tests)
// ---------------------------------------------------------------------------

/**
 * deps:
 *   requestToken(device) → { forgejoHost, username, token }
 *   runGit(args, { input }) → { code, stdout, stderr }   (rejects only if git can't spawn)
 *   commandExists(cmd) → boolean        (linux secret-service detection)
 *   platform: string
 *   log(line): void                     (status copy → stderr)
 */
export async function runGitSetup(deps, { device } = {}) {
  const dev = deviceLabel(device ?? hostname());

  const access = await deps.requestToken(dev);
  const host = parseForgejoHost(access?.forgejoHost);
  if (!host || !access?.token || !access?.username) {
    throw new GitSetupError(
      "The server didn't return a usable git credential. Run git-setup again.",
    );
  }

  // git on PATH?
  let version;
  try {
    version = await deps.runGit(["--version"]);
  } catch {
    version = { code: 127 };
  }
  if (version.code !== 0) {
    throw new GitSetupError(
      "git is not installed or not on your PATH. Install git, then run git-setup again.",
    );
  }

  // Credential helper configured? Configure the platform default if not.
  let helper = "";
  try {
    helper = (await deps.runGit(["config", "--global", "credential.helper"])).stdout.trim();
  } catch {
    helper = "";
  }
  let plaintextWarning = false;
  if (!helper) {
    const hasSecretService =
      deps.platform === "linux" ? await deps.commandExists("git-credential-libsecret") : true;
    const chosen = chooseHelper(deps.platform, { hasSecretService });
    plaintextWarning = chosen.plaintextWarning;
    const set = await deps.runGit(["config", "--global", "credential.helper", chosen.helper]);
    if (set.code !== 0) {
      throw new GitSetupError(
        "Couldn't configure a git credential helper. Configure one (e.g. `git config --global credential.helper`) and run git-setup again.",
      );
    }
    helper = chosen.helper;
  }

  // Inject the token into the OS store — stdin only; never an arg, never logged.
  const approve = await deps.runGit(["credential", "approve"], {
    input: gitCredentialInput({ host, username: access.username, token: access.token }),
  });
  if (approve.code !== 0) {
    throw new GitSetupError(
      "git rejected the credential. Check your git credential helper and run git-setup again.",
    );
  }

  // Verify the whole chain with a real authenticated fetch.
  const personalUrl = `https://${host}/${access.username}/${PERSONAL_REPO}.git`;
  const ls = await deps.runGit(["ls-remote", personalUrl]);
  if (ls.code !== 0) {
    throw new GitSetupError(
      "Saved the credential, but a test git fetch failed. Check your network and credential helper, then run git-setup again.",
    );
  }

  if (plaintextWarning) {
    deps.log(
      "Warning: no OS secret service was found, so git stores your credential in PLAINTEXT (~/.git-credentials). Protect this machine and avoid shared accounts.",
    );
  }
  deps.log(
    "Git access is set up. Plain `git clone` of your role plugin and personal repos now works with no prompt — and a local agent reusing this git client needs no separate sign-in.",
  );

  // Machine-readable result — host/username/helper only, NEVER the token.
  return {
    ok: true,
    forgejoHost: access.forgejoHost,
    username: access.username,
    helper,
    plaintextWarning,
  };
}

// ---------------------------------------------------------------------------
// Real dependency wiring (CLI)
// ---------------------------------------------------------------------------

function realRunGit(args, { input } = {}) {
  return new Promise((resolve, reject) => {
    // GIT_TERMINAL_PROMPT=0 so a missing/declined credential fails fast with a
    // non-zero exit instead of blocking on an interactive username/password
    // prompt (the verify ls-remote in particular must never hang).
    const child = spawn("git", args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject); // ENOENT when git is missing
    child.on("close", (code) => resolve({ code: code ?? 0, stdout, stderr }));
    child.stdin.end(input ?? "");
  });
}

function realCommandExists(cmd) {
  return new Promise((resolve) => {
    const child = spawn("sh", ["-c", `command -v ${cmd}`], { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

// Only run as a CLI — tests import the pure helpers + runGitSetup above.
// Mirrors every other guild script: print the "Acting as <email>" banner first
// (SKILL.md hard rule), then run through the shared runCommand wrapper, which
// prints the JSON result to stdout, redacts errors to stderr, and sets the exit
// code. GitSetupError messages are body-free, so runCommand's generic branch is
// safe to surface verbatim.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCommand(async () => {
    await actingAs();
    return runGitSetup(
      {
        requestToken: (device) => postJson("/api/account/git-access", { device }),
        runGit: realRunGit,
        commandExists: realCommandExists,
        platform: process.platform,
        log: (line) => process.stderr.write(`${line}\n`),
      },
      {},
    );
  });
}
