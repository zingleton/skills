#!/usr/bin/env node
// guild-memory: memory-activate.mjs — per-project memory activation.
//
//   node memory-activate.mjs [<projectDir>]
//
// Turns Hindsight memory ON for ONE project by writing the UserPromptSubmit
// (recall) and Stop (retain) capture hooks into that project's
// .claude/settings.json. Hooks only — there is no MCP server to register.
//
// The hook command points at the USER-SCOPE-installed memory-hook.mjs
// (~/.claude/skills/guild-memory/scripts/, honoring AI_POWER_GUILD_SKILLS_DIR —
// the same override install-skills.mjs uses), as a QUOTED absolute path so a
// space in the home directory can't break the command. If that install is
// absent, activation FAILS LOUDLY and writes nothing — never a dead path a
// fail-open hook would later swallow.
//
// Merges into existing project settings without clobbering other hooks, and is
// idempotent: re-activating does not duplicate the memory hooks. Default target
// is the COF project (PersonalChiefOfStaff in the current directory); pass a
// project directory to target a different one.
//
// Stdout is machine-readable JSON; human copy goes to stderr.

import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { defaultUserSkillsDir } from "../../guild-connect/scripts/install-skills.mjs";

export class MemoryActivateError extends Error {
  constructor(message) {
    super(message);
    this.name = "MemoryActivateError";
  }
}

const slash = (p) => p.split("\\").join("/");

// Capture-hook timeouts (seconds) — mirror the shape the plugin manifest used
// before it was removed: recall is quick, retain has a little more headroom.
const RECALL_TIMEOUT = 15;
const RETAIN_TIMEOUT = 20;

/**
 * Build the UserPromptSubmit (recall) + Stop (retain) hook groups for a given
 * absolute path to memory-hook.mjs. The path is QUOTED inside the command so a
 * space in it (e.g. a Windows home dir) does not split the command.
 */
export function hookBlock(absHookPath) {
  const cmd = (action) => `node "${absHookPath}" ${action}`;
  return {
    UserPromptSubmit: [
      { hooks: [{ type: "command", command: cmd("recall"), timeout: RECALL_TIMEOUT }] },
    ],
    Stop: [
      { hooks: [{ type: "command", command: cmd("retain"), timeout: RETAIN_TIMEOUT }] },
    ],
  };
}

/**
 * Merge hook groups (e.g. from hookBlock) into a parsed settings object without
 * dropping existing entries. Idempotent: a group whose command already appears
 * under that event is not added again. Returns a new object; `existing` is not
 * mutated.
 */
export function mergeSettings(existing, additions) {
  const out =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? structuredClone(existing)
      : {};
  out.hooks =
    out.hooks && typeof out.hooks === "object" && !Array.isArray(out.hooks)
      ? out.hooks
      : {};

  for (const event of Object.keys(additions)) {
    const current = Array.isArray(out.hooks[event]) ? out.hooks[event].slice() : [];
    for (const group of additions[event]) {
      const cmds = (group.hooks || []).map((h) => h.command);
      const present = current.some(
        (g) => Array.isArray(g.hooks) && g.hooks.some((h) => cmds.includes(h.command)),
      );
      if (!present) current.push(group);
    }
    out.hooks[event] = current;
  }
  return out;
}

/** Default COF project: PersonalChiefOfStaff in the current directory. */
export function defaultCofProjectDir(cwd = process.cwd()) {
  return join(cwd, "PersonalChiefOfStaff");
}

/** Absolute path to the user-scope-installed memory-hook.mjs. */
export function installedHookPath(userSkillsDir = defaultUserSkillsDir()) {
  return join(userSkillsDir, "guild-memory", "scripts", "memory-hook.mjs");
}

const accessExists = (p) => access(p).then(() => true, () => false);

/**
 * Activate memory for one project: write the capture hooks into its
 * .claude/settings.json. Returns the result object (only fs side effects).
 *
 * opts: { projectDir?, userSkillsDir? }
 * deps (injected for tests): { readFile, writeFile, mkdir, exists }.
 */
export async function runMemoryActivate(opts = {}, deps = {}) {
  const doRead = deps.readFile ?? readFile;
  const doWrite = deps.writeFile ?? writeFile;
  const doMkdir = deps.mkdir ?? mkdir;
  const exists = deps.exists ?? accessExists;

  const userSkillsDir = opts.userSkillsDir ?? defaultUserSkillsDir();
  const hookPath = installedHookPath(userSkillsDir);

  // Fail loudly if the user-scope install is missing — don't write a dead path.
  if (!(await exists(hookPath))) {
    throw new MemoryActivateError(
      `memory-hook.mjs not found at ${slash(hookPath)}. Install the guild skills ` +
        `at user scope first (run guild-connect's install-skills.mjs), then re-activate.`,
    );
  }

  const projectDir = resolve(opts.projectDir || defaultCofProjectDir());
  const settingsPath = join(projectDir, ".claude", "settings.json");

  let existing = {};
  let raw;
  try {
    raw = await doRead(settingsPath, "utf8");
  } catch {
    raw = null;
  }
  if (raw != null) {
    try {
      existing = JSON.parse(raw);
    } catch {
      throw new MemoryActivateError(
        `Existing settings at ${slash(settingsPath)} is not valid JSON; fix it before activating.`,
      );
    }
  }

  const additions = hookBlock(hookPath);
  const merged = mergeSettings(existing, additions);
  const alreadyActive = JSON.stringify(merged) === JSON.stringify(existing);

  await doMkdir(dirname(settingsPath), { recursive: true });
  await doWrite(settingsPath, `${JSON.stringify(merged, null, 2)}\n`);

  return {
    ok: true,
    projectDir: slash(projectDir),
    settingsPath: slash(settingsPath),
    hookPath: slash(hookPath),
    events: Object.keys(additions),
    alreadyActive,
  };
}

function say(line) {
  process.stderr.write(`${line}\n`);
}

async function main(rawArg) {
  const result = await runMemoryActivate({ projectDir: rawArg });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.alreadyActive) {
    say(`Memory already active for ${result.projectDir} — no change.`);
  } else {
    say(`Memory activated for ${result.projectDir} (hooks written to ${result.settingsPath}).`);
  }
  say("Memory fires only in this project. Re-run any time — it is idempotent.");
  return 0;
}

// Robust main-guard across platforms (handles Windows drive-letter paths).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv[2]).then(
    (code) => process.exit(code ?? 0),
    (err) => {
      process.stderr.write(`${err?.message ?? "Unexpected failure."}\n`);
      process.exit(1);
    },
  );
}
