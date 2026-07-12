// install-skills.mjs unit tests — the user-scope installer. Pure helpers plus
// the installSkills orchestrator against a real temp dir (no network, no home
// dir touched). node:test.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  skillsToInstall,
  defaultUserSkillsDir,
  installSkills,
} from "../scripts/install-skills.mjs";

// --- pure helpers -----------------------------------------------------------

test("skillsToInstall returns only the bootstrap folders (connect + installer)", () => {
  // U8/R13: the Chief of Staff setup and portable memory now ship via the
  // catalog, not the bootstrap — so they are deliberately absent here.
  assert.deepEqual(skillsToInstall(), ["guild-connect", "guild-skills"]);
  assert.equal(skillsToInstall().includes("claudecof-setup"), false);
  assert.equal(skillsToInstall().includes("guild-memory"), false);
});

test("defaultUserSkillsDir honors the env override, else ~/.claude/skills", () => {
  assert.equal(
    defaultUserSkillsDir({ AI_POWER_GUILD_SKILLS_DIR: "/custom/skills" }, "/home/u"),
    "/custom/skills",
  );
  const never = () => false;
  assert.equal(defaultUserSkillsDir({}, "/home/u", never), join("/home/u", ".claude", "skills"));
});

test("defaultUserSkillsDir detects a Hermes agent home (~/.hermes → its skills dir)", () => {
  const hermesAt = (path) => (p) => p === path;
  // ~/.hermes exists → install into the Hermes skills dir.
  assert.equal(
    defaultUserSkillsDir({}, "/home/u", hermesAt(join("/home/u", ".hermes"))),
    join("/home/u", ".hermes", "skills"),
  );
  // $HERMES_HOME beats the ~/.hermes default location.
  assert.equal(
    defaultUserSkillsDir({ HERMES_HOME: "/data/hermes" }, "/home/u", hermesAt("/data/hermes")),
    join("/data/hermes", "skills"),
  );
  // $HERMES_HOME set but absent on disk → not a Hermes host; fall back.
  assert.equal(
    defaultUserSkillsDir({ HERMES_HOME: "/data/hermes" }, "/home/u", () => false),
    join("/home/u", ".claude", "skills"),
  );
});

test("defaultUserSkillsDir prefers the running harness: CLAUDECODE wins over ~/.hermes on disk", () => {
  assert.equal(
    defaultUserSkillsDir({ CLAUDECODE: "1" }, "/home/u", () => true),
    join("/home/u", ".claude", "skills"),
  );
  // Explicit override still beats everything.
  assert.equal(
    defaultUserSkillsDir(
      { CLAUDECODE: "1", AI_POWER_GUILD_SKILLS_DIR: "/custom/skills" },
      "/home/u",
      () => true,
    ),
    "/custom/skills",
  );
});

test("every bootstrap skill folder actually exists in the repo with a SKILL.md", async () => {
  // scripts/tests → guild-connect → skills → repo root.
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  for (const name of skillsToInstall()) {
    const skillMd = join(repoRoot, "skills", name, "SKILL.md");
    await access(skillMd); // throws if the bootstrap references a missing skill
  }
});

// --- orchestrator against a temp filesystem ---------------------------------

const exists = (p) => access(p).then(() => true, () => false);

/** Build a fake source skills tree with the three folders + a stray secret. */
async function makeSrc() {
  const root = await mkdtemp(join(tmpdir(), "guild-src-"));
  const src = join(root, "skills");
  for (const name of skillsToInstall()) {
    await mkdir(join(src, name, "scripts"), { recursive: true });
    await writeFile(join(src, name, "SKILL.md"), `# ${name}\n`);
    await writeFile(join(src, name, "scripts", "run.mjs"), `// ${name}\n`);
  }
  // A secret that must never be copied into the user-scope install.
  await writeFile(join(src, "guild-connect", "credentials.json"), '{"token":"nope"}');
  return { root, src };
}

test("installSkills copies each skill folder into the target dir", async () => {
  const { root, src } = await makeSrc();
  const userDir = join(root, "userskills");
  try {
    const result = await installSkills({ skillsSrcDir: src, userSkillsDir: userDir });

    assert.equal(result.ok, true);
    assert.equal(result.installed.length, skillsToInstall().length);
    for (const name of skillsToInstall()) {
      assert.equal(await exists(join(userDir, name, "SKILL.md")), true, `${name} SKILL.md`);
      assert.equal(await exists(join(userDir, name, "scripts", "run.mjs")), true, `${name} script`);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("installSkills never copies credential/secret files", async () => {
  const { root, src } = await makeSrc();
  const userDir = join(root, "userskills");
  try {
    await installSkills({ skillsSrcDir: src, userSkillsDir: userDir });
    assert.equal(
      await exists(join(userDir, "guild-connect", "credentials.json")),
      false,
      "credentials.json must be filtered out",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("re-running refreshes in place (update path) and drops stale files", async () => {
  const { root, src } = await makeSrc();
  const userDir = join(root, "userskills");
  try {
    await installSkills({ skillsSrcDir: src, userSkillsDir: userDir });

    // Simulate a leftover file from a prior install that no longer exists in src.
    await writeFile(join(userDir, "guild-connect", "old-removed.mjs"), "stale");

    const result = await installSkills({ skillsSrcDir: src, userSkillsDir: userDir });

    assert.equal(result.installed.length, skillsToInstall().length, "no duplication on re-run");
    assert.equal(
      await exists(join(userDir, "guild-connect", "old-removed.mjs")),
      false,
      "stale file removed on refresh",
    );
    assert.equal(await exists(join(userDir, "guild-connect", "SKILL.md")), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("result JSON lists installed skills with forward-slash paths", async () => {
  const { root, src } = await makeSrc();
  const userDir = join(root, "userskills");
  try {
    const result = await installSkills({ skillsSrcDir: src, userSkillsDir: userDir });
    for (const s of result.installed) {
      assert.ok(skillsToInstall().includes(s.name));
      assert.doesNotMatch(s.path, /\\/, "paths use forward slashes");
      assert.match(s.path, new RegExp(`/${s.name}$`));
    }
    assert.doesNotMatch(result.userSkillsDir, /\\/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
