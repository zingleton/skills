#!/usr/bin/env node
// guild-connect: install-skills.mjs — user-scope installer and update path.
//
//   node install-skills.mjs
//
// Copies the guild skill folders into the user-scope skills dir
// (~/.claude/skills/) so they are available in EVERY future Claude Code session
// — no marketplace, no `claude plugin install`. Re-running it is the update
// path: each skill folder is refreshed in place (stale files removed, no
// duplication). Credential/secret files never live inside the repo skill
// folders, and the copy filter skips them defensively just in case.
//
// The user skills dir is ~/.claude/skills/ by default, overridable with
// AI_POWER_GUILD_SKILLS_DIR (used by tests, and honored identically by
// guild-memory's memory-activate.mjs when it resolves the installed hook path).
//
// Stdout is machine-readable JSON; human copy goes to stderr.

import { cp, rm, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
// scripts → guild-connect → skills → repo root.
const REPO_ROOT = resolve(HERE, "..", "..", "..");
const SKILLS_SRC = join(REPO_ROOT, "skills");

const slash = (p) => p.split("\\").join("/");

/**
 * The BOOTSTRAP skill folders the in-session installer copies (skills-delivery
 * U8, R13): just the connect plumbing and the guild-skills installer. The
 * Chief of Staff setup and portable memory are no longer bootstrapped here —
 * they ship through the skills catalog and are installed on demand with
 * `guild-skills install`. guild-skills reuses guild-connect's credential/api
 * modules via `../../guild-connect/scripts/`, so the two install together.
 */
export function skillsToInstall() {
  return ["guild-connect", "guild-skills"];
}

/**
 * Resolve the user-scope skills directory. AI_POWER_GUILD_SKILLS_DIR overrides
 * (tests, locked-down harnesses); otherwise ~/.claude/skills/. Shared with
 * memory-activate.mjs so both resolve the same install location.
 */
export function defaultUserSkillsDir(env = process.env, home = homedir()) {
  return env.AI_POWER_GUILD_SKILLS_DIR || join(home, ".claude", "skills");
}

// Never carry a credential/secret file into the user-scope copy. These don't
// live in the repo skill folders, but filter them out defensively.
const SECRET_NAMES = new Set(["credentials.json", "memory.json"]);

function copyFilter(src) {
  const name = src.split(/[\\/]/).pop();
  return !SECRET_NAMES.has(name);
}

function say(line) {
  process.stderr.write(`${line}\n`);
}

/**
 * Copy each guild skill folder from `skillsSrcDir` into `userSkillsDir`,
 * refreshing in place. Returns the result object (only fs side effects).
 *
 * deps (injected for tests): { cp, rm, mkdir }.
 */
export async function installSkills({ skillsSrcDir, userSkillsDir }, deps = {}) {
  const doCp = deps.cp ?? cp;
  const doRm = deps.rm ?? rm;
  const doMkdir = deps.mkdir ?? mkdir;

  await doMkdir(userSkillsDir, { recursive: true });

  const installed = [];
  for (const name of skillsToInstall()) {
    const from = join(skillsSrcDir, name);
    const to = join(userSkillsDir, name);
    // Clean-refresh: drop the old copy so a renamed/deleted file can't linger.
    await doRm(to, { recursive: true, force: true });
    await doCp(from, to, { recursive: true, filter: copyFilter });
    installed.push({ name, path: slash(to) });
  }

  return { ok: true, userSkillsDir: slash(userSkillsDir), installed };
}

async function main() {
  const userSkillsDir = defaultUserSkillsDir();
  const result = await installSkills({ skillsSrcDir: SKILLS_SRC, userSkillsDir });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  say(`Installed ${result.installed.length} guild skills into ${result.userSkillsDir}`);
  for (const s of result.installed) say(`  - ${s.name}`);
  say("Re-run this any time to update them.");
  return 0;
}

// Robust main-guard across platforms (handles Windows drive-letter paths).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => process.exit(code ?? 0),
    (err) => {
      process.stderr.write(`${err?.message ?? "Unexpected failure."}\n`);
      process.exit(1);
    },
  );
}
