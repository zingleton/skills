// guild-skills: uninstall tests (U5; R18/R20).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

import { installSkills } from "../scripts/install.mjs";
import { uninstallSkills } from "../scripts/uninstall.mjs";
import { readLockfile } from "../scripts/lockfile.mjs";
import { resolveScope } from "../scripts/scopes.mjs";

const exists = (p) => access(p).then(() => true, () => false);

async function tmpCtx() {
  const base = await mkdtemp(join(tmpdir(), "guild-uninst-"));
  return { base, ctx: { cwd: join(base, "proj"), home: join(base, "home"), env: {} } };
}

const entry = (slug) => ({
  slug,
  sourceRepo: "zingleton/skills",
  sourcePath: `skills/${slug}`,
  pinnedCommit: "c1",
  originalSourceRepo: null,
});

const fakeFetch = async ({ stageDir }) => {
  await mkdir(dirname(join(stageDir, "SKILL.md")), { recursive: true }).catch(() => {});
  await mkdir(stageDir, { recursive: true });
  await writeFile(join(stageDir, "SKILL.md"), "# s\n");
};

test("uninstall removes files and lockfile entry; unknown slug errors cleanly", async () => {
  const { base, ctx } = await tmpCtx();
  try {
    const deps = { fetchCatalog: async () => [entry("a")], fetchSkill: fakeFetch };
    await installSkills({ slugs: ["a"], scope: "project", ctx, deps });
    const root = resolveScope("project", ctx);
    assert.equal(await exists(join(root.skillsDir, "a")), true);

    const res = await uninstallSkills({ slugs: ["a"], ctx });
    assert.equal(res.ok, true);
    assert.equal(res.results[0].status, "removed");
    assert.equal(await exists(join(root.skillsDir, "a")), false);
    assert.equal("a" in (await readLockfile(root.lockfile)).skills, false);

    const missing = await uninstallSkills({ slugs: ["ghost"], ctx });
    assert.equal(missing.ok, false);
    assert.match(missing.results[0].detail, /not-installed/);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("uninstalling a locally-modified skill refuses without --force", async () => {
  const { base, ctx } = await tmpCtx();
  try {
    const deps = { fetchCatalog: async () => [entry("m")], fetchSkill: fakeFetch };
    await installSkills({ slugs: ["m"], scope: "project", ctx, deps });
    const root = resolveScope("project", ctx);
    await writeFile(join(root.skillsDir, "m", "SKILL.md"), "# edited\n");

    const blocked = await uninstallSkills({ slugs: ["m"], ctx });
    assert.equal(blocked.results[0].status, "blocked-modified");
    assert.equal(await exists(join(root.skillsDir, "m")), true, "files kept");

    const forced = await uninstallSkills({ slugs: ["m"], force: true, ctx });
    assert.equal(forced.results[0].status, "removed");
    assert.equal(await exists(join(root.skillsDir, "m")), false);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
