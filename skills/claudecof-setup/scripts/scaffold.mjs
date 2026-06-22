#!/usr/bin/env node
// claudecof-setup: scaffold.mjs (U3) — create the LOCAL Chief of Staff wrapper
// around the portable personal repo.
//
//   node scaffold.mjs '<json>'
//
// The durable layer (memory, skills, Tools) lives in the cloned `personal` repo
// under <project>/repo/ and is owned by guild-connect's repo-setup.mjs. scaffold
// writes only the local, regenerated-from-template wrapper:
//
//   <project>/
//   ├── CLAUDE.md            customized config, points at repo/   (this script)
//   ├── .claude/skills       junction/symlink -> repo/skills      (this script)
//   ├── repo/                clone of `personal`                  (repo-setup)
//   └── Notes/chief-of-staff-guide.md                            (this script)
//
// JSON fields (all optional except targetDir):
//   targetDir            where the project lives (required)
//   force                overwrite an existing CLAUDE.md (default false)
//   name                 → {{NAME}}
//   aboutMe              → {{ABOUT_ME}}
//   keyPeople            → {{KEY_PEOPLE}}
//   calendarPriorities   → {{CALENDAR_PRIORITIES}}
//   email                → folded into {{LINKS}}
//   links                array of {label, url} → folded into {{LINKS}}
//
// Stdout is machine-readable JSON; human copy goes to stderr. CLAUDE.md is never
// overwritten unless force:true — a chief of staff config is precious once
// customized. The Notes guide is seeded only when absent.

import { readFile, writeFile, mkdir, access, cp, symlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS = resolve(HERE, "..", "assets");

// Defaults preserve the template's own guidance text, so a field the member
// chose not to fill still reads as a helpful prompt rather than an empty hole.
const DEFAULTS = {
  NAME: "[YOUR NAME]",
  ABOUT_ME:
    "[Describe your role, industry, key responsibilities]\n" +
    "[What you're great at vs what you struggle with]",
  KEY_PEOPLE:
    "[List important people and their relationship to you]\n" +
    '[Example: "Partner - protect and create time together"]',
  CALENDAR_PRIORITIES:
    "[Customize your calendar priorities]\n" +
    '[Example: "Protect deep work blocks 9-11 AM"]',
  LINKS: "[add your email and links]",
};

function fill(tpl, map) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_m, k) =>
    k in map && map[k] != null && map[k] !== "" ? map[k] : DEFAULTS[k] ?? "",
  );
}

/** Build the {{LINKS}} block from email + links; empty when nothing supplied. */
export function linksBlock(cfg) {
  const lines = [];
  if (cfg.email) lines.push(`- Email: ${cfg.email}`);
  if (Array.isArray(cfg.links)) {
    for (const l of cfg.links) {
      if (l && l.url) lines.push(`- ${l.label ?? "Link"}: ${l.url}`);
    }
  }
  return lines.join("\n");
}

function say(line) {
  process.stderr.write(`${line}\n`);
}

async function exists(p) {
  return access(p).then(() => true, () => false);
}

const slash = (rel) => rel.split("\\").join("/");

/**
 * Wire <target>/.claude/skills → <target>/repo/skills so Claude Code discovers
 * the portable skills. Windows uses an NTFS junction (no elevation needed — see
 * the spike); POSIX uses a directory symlink. If linking throws (e.g. EPERM with
 * no symlink privilege, or EEXIST), fall back to a recursive copy — a
 * point-in-time SNAPSHOT, not a live link. No-op when repo/skills is absent.
 *
 * deps (injected for tests): { platform, symlink }.
 */
export async function linkSkills(targetDir, deps = {}) {
  const platform = deps.platform ?? process.platform;
  const doSymlink = deps.symlink ?? symlink;
  const repoSkills = resolve(targetDir, "repo", "skills");
  if (!(await exists(repoSkills))) return { status: "no-source" };

  const link = join(targetDir, ".claude", "skills");
  if (await exists(link)) return { status: "exists" };

  await mkdir(dirname(link), { recursive: true });
  const type = platform === "win32" ? "junction" : "dir";
  try {
    await doSymlink(repoSkills, link, type);
    return { status: "linked" };
  } catch {
    await cp(repoSkills, link, { recursive: true });
    return { status: "copied" };
  }
}

/** Core scaffold logic — returns the result object (no process side effects beyond fs writes). */
export async function scaffold(cfg) {
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg) || typeof cfg.targetDir !== "string" || !cfg.targetDir) {
    throw new Error('JSON must be an object with a "targetDir" string.');
  }

  const target = resolve(cfg.targetDir);
  const claudeMdPath = join(target, "CLAUDE.md");

  if ((await exists(claudeMdPath)) && cfg.force !== true) {
    return { ok: false, status: "exists", path: claudeMdPath };
  }

  const [claudeTpl, guide] = await Promise.all([
    readFile(join(ASSETS, "claude-md-template.md"), "utf8"),
    readFile(join(ASSETS, "chief-of-staff-guide.md"), "utf8"),
  ]);

  const claudeMd = fill(claudeTpl, {
    NAME: cfg.name,
    ABOUT_ME: cfg.aboutMe,
    KEY_PEOPLE: cfg.keyPeople,
    CALENDAR_PRIORITIES: cfg.calendarPriorities,
    LINKS: linksBlock(cfg),
  });

  await mkdir(join(target, "Notes"), { recursive: true });

  const created = [];
  const skipped = [];

  await writeFile(claudeMdPath, claudeMd);
  created.push("CLAUDE.md");

  const guidePath = join(target, "Notes", "chief-of-staff-guide.md");
  if (await exists(guidePath)) {
    skipped.push("Notes/chief-of-staff-guide.md");
  } else {
    await writeFile(guidePath, guide);
    created.push("Notes/chief-of-staff-guide.md");
  }

  // Wire skills discovery to the portable repo (when repo-setup has run).
  const link = await linkSkills(target);
  if (link.status === "linked" || link.status === "copied") {
    created.push(".claude/skills");
  } else if (link.status === "exists") {
    skipped.push(".claude/skills");
  }

  return {
    ok: true,
    targetDir: target,
    created: created.map(slash),
    skipped: skipped.map(slash),
    skillsLink: link.status,
  };
}

async function main(rawJson) {
  if (!rawJson) throw new Error('Usage: node scaffold.mjs \'<json>\'  (needs at least {"targetDir":"..."})');
  let cfg;
  try {
    cfg = JSON.parse(rawJson);
  } catch {
    throw new Error("Argument must be valid JSON.");
  }

  const result = await scaffold(cfg);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

  if (!result.ok && result.status === "exists") {
    say(`A CLAUDE.md already exists at ${result.path}. Re-run with "force": true to overwrite.`);
    return 1;
  }

  say(`Personal Chief of Staff ready at ${result.targetDir}`);
  if (result.skillsLink === "copied") {
    say("Note: linked skills via a COPY (a snapshot) — your environment blocked symlink/junction creation.");
  } else if (result.skillsLink === "no-source") {
    say("Note: no repo/skills found yet — run guild-connect's repo-setup first to clone your personal repo.");
  }
  say(`Start it with:  cd "${result.targetDir}" && claude`);
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
