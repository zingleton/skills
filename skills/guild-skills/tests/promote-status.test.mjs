// guild-skills: promote + status tests (U5; R10/R11).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { installSkills } from "../scripts/install.mjs";
import { promoteSkills } from "../scripts/promote.mjs";
import { statusReport } from "../scripts/status.mjs";
import { readLockfile } from "../scripts/lockfile.mjs";
import { resolveScope } from "../scripts/scopes.mjs";

const exists = (p) => access(p).then(() => true, () => false);

async function tmpCtx() {
  const base = await mkdtemp(join(tmpdir(), "guild-prom-"));
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
  await mkdir(stageDir, { recursive: true });
  await writeFile(join(stageDir, "SKILL.md"), "# s\n");
};

test("promote moves files and the lockfile entry from project to global scope", async () => {
  const { base, ctx } = await tmpCtx();
  try {
    const deps = { fetchCatalog: async () => [entry("p")], fetchSkill: fakeFetch };
    await installSkills({ slugs: ["p"], scope: "project", ctx, deps });

    const project = resolveScope("project", ctx);
    const global = resolveScope("global", ctx);
    const res = await promoteSkills({ slugs: ["p"], ctx });
    assert.equal(res.results[0].status, "promoted");

    assert.equal(await exists(join(project.skillsDir, "p")), false, "gone from project");
    assert.equal(await exists(join(global.skillsDir, "p", "SKILL.md")), true, "in global");
    assert.equal("p" in (await readLockfile(project.lockfile)).skills, false);
    assert.equal((await readLockfile(global.lockfile)).skills.p.scope, "global");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("promote refuses when the slug already exists at global scope", async () => {
  const { base, ctx } = await tmpCtx();
  try {
    const deps = { fetchCatalog: async () => [entry("q")], fetchSkill: fakeFetch };
    await installSkills({ slugs: ["q"], scope: "project", ctx, deps });
    await installSkills({ slugs: ["q"], scope: "global", ctx, deps });

    const res = await promoteSkills({ slugs: ["q"], ctx });
    assert.equal(res.results[0].status, "error");
    assert.match(res.results[0].detail, /already-global/);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("status reports entries from both the project and global lockfiles with local state", async () => {
  const { base, ctx } = await tmpCtx();
  try {
    const deps = { fetchCatalog: async () => [entry("proj1"), entry("glob1")], fetchSkill: fakeFetch };
    await installSkills({ slugs: ["proj1"], scope: "project", ctx, deps });
    await installSkills({ slugs: ["glob1"], scope: "global", ctx, deps });

    // Modify the global one so status shows "modified".
    const global = resolveScope("global", ctx);
    await writeFile(join(global.skillsDir, "glob1", "SKILL.md"), "# edited\n");

    const report = await statusReport({ ctx });
    assert.equal(report.count, 2);
    const byslug = Object.fromEntries(report.skills.map((s) => [s.slug, s]));
    assert.equal(byslug.proj1.scope, "project");
    assert.equal(byslug.proj1.state, "clean");
    assert.equal(byslug.glob1.scope, "global");
    assert.equal(byslug.glob1.state, "modified");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
