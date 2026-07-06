// guild-skills: update flow tests (U6; R12/R16/R17/R20, AE4/AE5 update side).
// Offline — catalog and fetchSkill injected.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

import { installSkills } from "../scripts/install.mjs";
import { resolveUpdates, applyUpdates } from "../scripts/update.mjs";
import { readLockfile, upsertEntry } from "../scripts/lockfile.mjs";
import { resolveScope } from "../scripts/scopes.mjs";
import { FetchError } from "../scripts/fetch-skill.mjs";

const exists = (p) => access(p).then(() => true, () => false);

async function tmpCtx() {
  const base = await mkdtemp(join(tmpdir(), "guild-upd-"));
  return { base, ctx: { cwd: join(base, "proj"), home: join(base, "home"), env: {} } };
}

const entry = (slug, commit, over = {}) => ({
  slug,
  sourceRepo: "zingleton/skills",
  sourcePath: `skills/${slug}`,
  pinnedCommit: commit,
  originalSourceRepo: over.original ?? null,
});

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

async function install(slug, commit, ctx, scope = "project") {
  await installSkills({
    slugs: [slug],
    scope,
    ctx,
    deps: { fetchCatalog: async () => [entry(slug, commit)], fetchSkill: fakeFetch() },
  });
}

const find = (updates, slug) => updates.find((u) => u.slug === slug);

test("Covers AE4: a moved pin is reported update-available; nothing changes until apply, then re-pins", async () => {
  const { base, ctx } = await tmpCtx();
  try {
    await install("a", "c1", ctx);
    const root = resolveScope("project", ctx);

    const report = await resolveUpdates({ ctx, deps: { fetchCatalog: async () => [entry("a", "c2")] } });
    assert.equal(find(report.updates, "a").outcome, "update-available");
    assert.equal(find(report.updates, "a").toPin, "c2");
    // Nothing changed on disk or in the lockfile yet.
    assert.equal((await readFile(join(root.skillsDir, "a", "SKILL.md"), "utf8")).trim(), "# c1");
    assert.equal((await readLockfile(root.lockfile)).skills.a.pinnedCommit, "c1");

    const applied = await applyUpdates({
      slugs: ["a"],
      expectedPins: { a: "c2" },
      ctx,
      deps: { fetchCatalog: async () => [entry("a", "c2")], fetchSkill: fakeFetch() },
    });
    assert.equal(applied.results[0].status, "installed");
    assert.equal((await readLockfile(root.lockfile)).skills.a.pinnedCommit, "c2");
    assert.equal((await readFile(join(root.skillsDir, "a", "SKILL.md"), "utf8")).trim(), "# c2");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("Covers AE5 (update side): a fork is skipped, with an optional upstream-moved note", async () => {
  const { base, ctx } = await tmpCtx();
  try {
    await install("f", "c1", ctx);
    const root = resolveScope("project", ctx);
    const cur = (await readLockfile(root.lockfile)).skills.f;
    await upsertEntry(root.lockfile, "f", { ...cur, fork: true });

    const report = await resolveUpdates({ ctx, deps: { fetchCatalog: async () => [entry("f", "c2")] } });
    assert.equal(find(report.updates, "f").outcome, "fork-skipped");
    assert.equal(find(report.updates, "f").upstreamMoved, true);

    const applied = await applyUpdates({
      slugs: ["f"],
      ctx,
      deps: { fetchCatalog: async () => [entry("f", "c2")], fetchSkill: fakeFetch() },
    });
    assert.equal(applied.results[0].status, "skipped");
    assert.equal((await readLockfile(root.lockfile)).skills.f.pinnedCommit, "c1");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("a locally-modified non-fork is blocked; catalog-removed and up-to-date report distinctly", async () => {
  const { base, ctx } = await tmpCtx();
  try {
    await install("m", "c1", ctx);
    await install("r", "c1", ctx);
    await install("u", "c1", ctx);
    const root = resolveScope("project", ctx);
    await writeFile(join(root.skillsDir, "m", "SKILL.md"), "# edited\n");

    const report = await resolveUpdates({
      ctx,
      // 'm' pin moved (but modified → blocked); 'u' unchanged; 'r' absent from catalog.
      deps: { fetchCatalog: async () => [entry("m", "c2"), entry("u", "c1")] },
    });
    assert.equal(find(report.updates, "m").outcome, "blocked-modified");
    assert.equal(find(report.updates, "r").outcome, "catalog-removed");
    assert.equal(find(report.updates, "u").outcome, "up-to-date");
    // Modified file untouched by the report.
    assert.equal((await readFile(join(root.skillsDir, "m", "SKILL.md"), "utf8")).trim(), "# edited");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("a fetch failure at apply is source-unreachable and leaves the lockfile pin unchanged", async () => {
  const { base, ctx } = await tmpCtx();
  try {
    await install("s", "c1", ctx);
    const root = resolveScope("project", ctx);
    const applied = await applyUpdates({
      slugs: ["s"],
      expectedPins: { s: "c2" },
      ctx,
      deps: {
        fetchCatalog: async () => [entry("s", "c2")],
        fetchSkill: fakeFetch({ failCommits: { c2: "unreachable" } }),
      },
    });
    assert.equal(applied.results[0].status, "error");
    assert.match(applied.results[0].detail, /source-unreachable/);
    assert.equal((await readLockfile(root.lockfile)).skills.s.pinnedCommit, "c1");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("a curator re-pin between report and apply aborts that skill (nothing installed)", async () => {
  const { base, ctx } = await tmpCtx();
  try {
    await install("z", "c1", ctx);
    const root = resolveScope("project", ctx);
    // Member saw c2, but the catalog now says c3.
    const applied = await applyUpdates({
      slugs: ["z"],
      expectedPins: { z: "c2" },
      ctx,
      deps: { fetchCatalog: async () => [entry("z", "c3")], fetchSkill: fakeFetch() },
    });
    assert.equal(applied.results[0].status, "re-pinned-aborted");
    assert.equal((await readLockfile(root.lockfile)).skills.z.pinnedCommit, "c1");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("a promoted (global-scope) skill is still reported and re-pinned by an update run", async () => {
  const { base, ctx } = await tmpCtx();
  try {
    await install("g", "c1", ctx, "global");
    const global = resolveScope("global", ctx);

    const report = await resolveUpdates({ ctx, deps: { fetchCatalog: async () => [entry("g", "c2")] } });
    const u = find(report.updates, "g");
    assert.equal(u.outcome, "update-available");
    assert.equal(u.scope, "global");

    const applied = await applyUpdates({
      slugs: ["g"],
      expectedPins: { g: "c2" },
      ctx,
      deps: { fetchCatalog: async () => [entry("g", "c2")], fetchSkill: fakeFetch() },
    });
    assert.equal(applied.results[0].status, "installed");
    assert.equal((await readLockfile(global.lockfile)).skills.g.pinnedCommit, "c2");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("update apply that removes an upstream file leaves no stale file", async () => {
  const { base, ctx } = await tmpCtx();
  try {
    // Install c1 with an extra file via a custom catalog + fetch.
    const root = resolveScope("project", ctx);
    await installSkills({
      slugs: ["y"],
      scope: "project",
      ctx,
      deps: {
        fetchCatalog: async () => [entry("y", "c1")],
        fetchSkill: fakeFetch({ files: () => ({ "SKILL.md": "# c1\n", "extra.md": "x" }) }),
      },
    });
    assert.equal(await exists(join(root.skillsDir, "y", "extra.md")), true);

    await applyUpdates({
      slugs: ["y"],
      expectedPins: { y: "c2" },
      ctx,
      deps: {
        fetchCatalog: async () => [entry("y", "c2")],
        fetchSkill: fakeFetch({ files: () => ({ "SKILL.md": "# c2\n" }) }),
      },
    });
    assert.equal(await exists(join(root.skillsDir, "y", "extra.md")), false, "stale file removed");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
