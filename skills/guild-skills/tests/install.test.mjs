// guild-skills: install orchestrator tests (U5; R9/R11/R20, AE3). Offline —
// fetchSkill and the catalog are injected, so no git and no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

import { installSkills, installOne, parseArgs } from "../scripts/install.mjs";
import { readLockfile } from "../scripts/lockfile.mjs";
import { resolveScope } from "../scripts/scopes.mjs";
import { FetchError } from "../scripts/fetch-skill.mjs";

const exists = (p) => access(p).then(() => true, () => false);

async function tmpCtx() {
  const base = await mkdtemp(join(tmpdir(), "guild-inst-"));
  return { base, ctx: { cwd: join(base, "proj"), home: join(base, "home"), env: {} } };
}

const entry = (slug, over = {}) => ({
  slug,
  sourceRepo: "zingleton/skills",
  sourcePath: `skills/${slug}`,
  pinnedCommit: over.commit ?? "c1",
  originalSourceRepo: over.original ?? null,
  dependencyNotes: over.deps ?? null,
});

// Fake fetch: writes files into stageDir, or throws for configured commits.
function fakeFetch(spec = {}) {
  return async ({ commit, stageDir }) => {
    const fail = spec.failCommits?.[commit];
    if (fail) throw new FetchError(fail, `simulated ${fail}`);
    await mkdir(stageDir, { recursive: true });
    const files = spec.files ? spec.files(commit) : { "SKILL.md": `# ${commit}\n` };
    for (const [name, content] of Object.entries(files)) {
      await mkdir(join(stageDir, dirname(name)), { recursive: true }).catch(() => {});
      await writeFile(join(stageDir, name), content);
    }
  };
}

test("Covers AE3: two skills install with complete lockfile entries; re-run is a no-op", async () => {
  const { base, ctx } = await tmpCtx();
  try {
    const deps = { fetchCatalog: async () => [entry("alpha"), entry("beta")], fetchSkill: fakeFetch() };
    const res = await installSkills({ slugs: ["alpha", "beta"], scope: "project", ctx, deps });
    assert.equal(res.ok, true);
    assert.deepEqual(res.results.map((r) => r.status), ["installed", "installed"]);

    const root = resolveScope("project", ctx);
    assert.equal(await exists(join(root.skillsDir, "alpha", "SKILL.md")), true);
    assert.equal(await exists(join(root.skillsDir, "beta", "SKILL.md")), true);

    const lock = await readLockfile(root.lockfile);
    const a = lock.skills.alpha;
    assert.equal(a.source, "zingleton/skills");
    assert.equal(a.skillPath, "skills/alpha");
    assert.equal(a.pinnedCommit, "c1");
    assert.equal(a.scope, "project");
    assert.equal(a.fork, false);
    assert.equal(a.catalogSlug, "alpha");
    assert.equal(typeof a.computedHash, "string");

    const rerun = await installSkills({ slugs: ["alpha", "beta"], scope: "project", ctx, deps });
    assert.deepEqual(rerun.results.map((r) => r.status), ["noop", "noop"]);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("partial failure: a missing-path skill fails while the others install; lockfile stays consistent", async () => {
  const { base, ctx } = await tmpCtx();
  try {
    const deps = {
      fetchCatalog: async () => [entry("a"), entry("b", { commit: "gone" }), entry("c")],
      fetchSkill: fakeFetch({ failCommits: { gone: "missing-path" } }),
    };
    const res = await installSkills({ slugs: ["a", "b", "c"], scope: "project", ctx, deps });
    assert.equal(res.ok, false);
    const byslug = Object.fromEntries(res.results.map((r) => [r.slug, r.status]));
    assert.equal(byslug.a, "installed");
    assert.equal(byslug.b, "error");
    assert.equal(byslug.c, "installed");

    const lock = await readLockfile(resolveScope("project", ctx).lockfile);
    assert.deepEqual(Object.keys(lock.skills).sort(), ["a", "c"]);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("an unknown slug (not in recommendations) errors cleanly without touching disk", async () => {
  const { base, ctx } = await tmpCtx();
  try {
    const res = await installSkills({
      slugs: ["ghost"],
      scope: "project",
      ctx,
      deps: { fetchCatalog: async () => [entry("real")], fetchSkill: fakeFetch() },
    });
    assert.equal(res.results[0].status, "error");
    assert.match(res.results[0].detail, /unknown-slug/);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("R20: installing over a locally-modified skill refuses without --force, obeys it with --force", async () => {
  const { base, ctx } = await tmpCtx();
  try {
    const deps = { fetchCatalog: async () => [entry("x")], fetchSkill: fakeFetch() };
    await installSkills({ slugs: ["x"], scope: "project", ctx, deps });

    // Member edits the installed skill.
    const root = resolveScope("project", ctx);
    await writeFile(join(root.skillsDir, "x", "SKILL.md"), "# my edits\n");

    const blocked = await installSkills({ slugs: ["x"], scope: "project", ctx, deps });
    assert.equal(blocked.results[0].status, "blocked-modified");
    assert.equal((await readFile(join(root.skillsDir, "x", "SKILL.md"), "utf8")).trim(), "# my edits");

    const forced = await installSkills({ slugs: ["x"], scope: "project", ctx, force: true, deps });
    assert.equal(forced.results[0].status, "installed");
    assert.equal((await readFile(join(root.skillsDir, "x", "SKILL.md"), "utf8")).trim(), "# c1");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("reinstall at a new pin replaces the whole dir (a removed file does not linger)", async () => {
  const { base, ctx } = await tmpCtx();
  try {
    const root = resolveScope("project", ctx);
    // First pin has an extra file; second pin drops it.
    const filesFor = (commit) =>
      commit === "c1" ? { "SKILL.md": "# c1\n", "extra.md": "x" } : { "SKILL.md": "# c2\n" };
    const deps = { fetchSkill: fakeFetch({ files: filesFor }) };

    await installOne({ entry: entry("y", { commit: "c1" }), scope: "project", root, force: false }, deps);
    assert.equal(await exists(join(root.skillsDir, "y", "extra.md")), true);

    await installOne({ entry: entry("y", { commit: "c2" }), scope: "project", root, force: false }, deps);
    assert.equal(await exists(join(root.skillsDir, "y", "extra.md")), false, "stale file gone");
    assert.equal((await readFile(join(root.skillsDir, "y", "SKILL.md"), "utf8")).trim(), "# c2");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("an interruption at the atomic rename leaves no partial skill dir and no lockfile entry", async () => {
  const { base, ctx } = await tmpCtx();
  try {
    const root = resolveScope("project", ctx);
    const crashingRename = async (from) => {
      if (String(from).includes(".stage-")) throw new Error("simulated crash");
      throw new Error("unexpected rename");
    };
    const res = await installOne(
      { entry: entry("z"), scope: "project", root, force: false },
      { fetchSkill: fakeFetch(), rename: crashingRename },
    );
    assert.equal(res.status, "error");
    assert.equal(await exists(join(root.skillsDir, "z")), false, "no partial skill dir");
    const lock = await readLockfile(root.lockfile);
    assert.equal("z" in lock.skills, false, "no lockfile entry");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("parseArgs reads --slugs, --scope, --force", () => {
  assert.deepEqual(parseArgs(["--slugs=a,b", "--scope=global", "--force"]), {
    slugs: ["a", "b"],
    scope: "global",
    force: true,
  });
  assert.deepEqual(parseArgs(["--slugs=solo"]), { slugs: ["solo"], scope: "project", force: false });
});
