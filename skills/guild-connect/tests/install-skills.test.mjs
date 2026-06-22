// install-skills.mjs unit tests — the user-scope installer. Pure helpers plus
// the installSkills orchestrator against a real temp dir (no network, no home
// dir touched). node:test.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  skillsToInstall,
  defaultUserSkillsDir,
  installSkills,
} from "../scripts/install-skills.mjs";

// --- pure helpers -----------------------------------------------------------

test("skillsToInstall returns the three guild skill folder names", () => {
  assert.deepEqual(skillsToInstall(), ["guild-connect", "claudecof-setup", "guild-memory"]);
});

test("defaultUserSkillsDir honors the env override, else ~/.claude/skills", () => {
  assert.equal(
    defaultUserSkillsDir({ AI_POWER_GUILD_SKILLS_DIR: "/custom/skills" }, "/home/u"),
    "/custom/skills",
  );
  assert.equal(defaultUserSkillsDir({}, "/home/u"), join("/home/u", ".claude", "skills"));
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
    assert.equal(result.installed.length, 3);
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

    assert.equal(result.installed.length, 3, "no duplication on re-run");
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
