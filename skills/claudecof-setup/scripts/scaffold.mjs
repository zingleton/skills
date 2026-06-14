#!/usr/bin/env node
// claudecof-setup: scaffold.mjs — create a Personal Chief of Staff project
// from the bundled templates, substituting the member's details. Doing the
// file-writing in a script (rather than having the model hand-copy a ~100-line
// template) keeps every run byte-identical and lets the model focus on the
// conversational part: gathering and confirming the customization values.
//
//   node scaffold.mjs '<json>'
//
// JSON fields (all optional except targetDir):
//   targetDir            where to create the project (required)
//   force                overwrite an existing CLAUDE.md (default false)
//   name                 → {{NAME}} in CLAUDE.md
//   aboutMe              → {{ABOUT_ME}} (role, strengths, focus, struggles)
//   keyPeople            → {{KEY_PEOPLE}} (CLAUDE.md + memory.md)
//   calendarPriorities   → {{CALENDAR_PRIORITIES}}
//   email                → memory.md "Email:"
//   links                array of {label, url} → memory.md links block
//
// Stdout is machine-readable JSON; human-readable copy goes to stderr. The
// script never overwrites an existing CLAUDE.md unless force:true — a chief of
// staff config is precious once customized.

import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
};

function fill(tpl, map) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_m, k) => (k in map && map[k] != null && map[k] !== "" ? map[k] : DEFAULTS[k] ?? ""));
}

function say(line) {
  process.stderr.write(`${line}\n`);
}

async function exists(p) {
  return access(p).then(() => true, () => false);
}

async function main(rawJson) {
  if (!rawJson) throw new Error("Usage: node scaffold.mjs '<json>'  (needs at least {\"targetDir\":\"...\"})");
  let cfg;
  try {
    cfg = JSON.parse(rawJson);
  } catch {
    throw new Error("Argument must be valid JSON.");
  }
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg) || typeof cfg.targetDir !== "string" || !cfg.targetDir) {
    throw new Error('JSON must be an object with a "targetDir" string.');
  }

  const target = resolve(cfg.targetDir);
  const claudeMdPath = join(target, "CLAUDE.md");

  if ((await exists(claudeMdPath)) && cfg.force !== true) {
    process.stdout.write(
      `${JSON.stringify({ ok: false, status: "exists", path: claudeMdPath }, null, 2)}\n`,
    );
    say(`A CLAUDE.md already exists at ${claudeMdPath}. Re-run with "force": true to overwrite.`);
    return 1;
  }

  // Load templates.
  const [claudeTpl, memoryTpl, contextTpl, guide] = await Promise.all([
    readFile(join(ASSETS, "claude-md-template.md"), "utf8"),
    readFile(join(ASSETS, "memory.md.template"), "utf8"),
    readFile(join(ASSETS, "context.txt.template"), "utf8"),
    readFile(join(ASSETS, "chief-of-staff-guide.md"), "utf8"),
  ]);

  // Build the substitution maps.
  const linksBlock = Array.isArray(cfg.links)
    ? cfg.links
        .filter((l) => l && l.url)
        .map((l) => `- ${l.label ?? "Link"}: ${l.url}`)
        .join("\n")
    : "";

  const claudeMd = fill(claudeTpl, {
    NAME: cfg.name,
    ABOUT_ME: cfg.aboutMe,
    KEY_PEOPLE: cfg.keyPeople,
    CALENDAR_PRIORITIES: cfg.calendarPriorities,
  });

  const memoryMd = fill(memoryTpl, {
    KEY_PEOPLE: cfg.keyPeople != null && cfg.keyPeople !== "" ? cfg.keyPeople : "[add key people]",
    EMAIL: cfg.email != null && cfg.email !== "" ? cfg.email : "[add your email]",
    LINKS: linksBlock,
  });

  const today = new Date().toISOString().slice(0, 10);
  const contextTxt = contextTpl.replace(/\{\{DATE\}\}/g, today);

  // Create the directory tree.
  await mkdir(join(target, "memory", "conversations"), { recursive: true });
  await mkdir(join(target, "Tools"), { recursive: true });
  await mkdir(join(target, "Notes"), { recursive: true });

  // Write files. Memory files are only seeded if absent, so re-running with
  // force to refresh CLAUDE.md never clobbers accumulated memory.
  const created = [];
  const skipped = [];
  await writeFile(claudeMdPath, claudeMd);
  created.push("CLAUDE.md");

  for (const [rel, content] of [
    [join("memory", "memory.md"), memoryMd],
    [join("memory", "context.txt"), contextTxt],
    [join("memory", "conversations", ".gitkeep"), ""],
    [join("Tools", ".gitkeep"), ""],
    [join("Notes", "chief-of-staff-guide.md"), guide],
  ]) {
    const p = join(target, rel);
    if (await exists(p)) {
      skipped.push(rel.split("\\").join("/"));
      continue;
    }
    await writeFile(p, content);
    created.push(rel.split("\\").join("/"));
  }

  process.stdout.write(
    `${JSON.stringify({ ok: true, targetDir: target, created, skipped }, null, 2)}\n`,
  );
  say(`Personal Chief of Staff project ready at ${target}`);
  say(`Start it with:  cd "${target}" && claude`);
  return 0;
}

main(process.argv[2]).then(
  (code) => process.exit(code ?? 0),
  (err) => {
    process.stderr.write(`${err?.message ?? "Unexpected failure."}\n`);
    process.exit(1);
  },
);
