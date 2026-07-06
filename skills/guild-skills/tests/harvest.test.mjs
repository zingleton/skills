// guild-skills: harvest tests (U7; R15/R16, AE5). Real local git remote for the
// happy path; injected git for the push-failure case.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, access } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { installSkills } from "../scripts/install.mjs";
import { harvestOne, provenanceContent, authRemoteUrl } from "../scripts/harvest.mjs";
import { resolveUpdates } from "../scripts/update.mjs";
import { readLockfile } from "../scripts/lockfile.mjs";
import { resolveScope } from "../scripts/scopes.mjs";

const exists = (p) => access(p).then(() => true, () => false);

function git(args, cwd) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

async function setup() {
  const base = await mkdtemp(join(tmpdir(), "guild-harv-"));
  const bare = join(base, "personal.git");
  git(["init", "--bare", "-q", bare], base);
  const repoDir = join(base, "clone");
  git(["clone", "-q", bare, repoDir], base);
  git(["config", "user.email", "t@example.com"], repoDir);
  git(["config", "user.name", "t"], repoDir);
  const ctx = { cwd: join(base, "proj"), home: join(base, "home"), env: {} };
  return { base, bare, repoDir, ctx };
}

const entry = (slug) => ({
  slug,
  sourceRepo: "zingleton/skills",
  sourcePath: `skills/${slug}`,
  pinnedCommit: "c1abc",
  originalSourceRepo: "acme/orig",
});
const fakeFetch = async ({ stageDir }) => {
  await mkdir(stageDir, { recursive: true });
  await writeFile(join(stageDir, "SKILL.md"), "# s\n");
};

async function installOne(slug, ctx) {
  await installSkills({
    slugs: [slug],
    scope: "project",
    ctx,
    deps: { fetchCatalog: async () => [entry(slug)], fetchSkill: fakeFetch },
  });
}

test("provenanceContent and authRemoteUrl are well-formed", () => {
  const p = JSON.parse(provenanceContent({ source: "a/b", skillPath: "skills/x", pinnedCommit: "sha", originalSource: "c/d" }));
  assert.equal(p.source, "a/b");
  assert.equal(p.originalSource, "c/d");
  assert.equal(
    authRemoteUrl({ host: "https://git.example", username: "guild-1", token: "tok" }),
    "https://guild-1:tok@git.example/guild-1/personal.git",
  );
});

test("Covers AE5: a modified skill harvests to the personal repo, flips to a fork, and updates skip it", async () => {
  const { base, bare, repoDir, ctx } = await setup();
  try {
    await installOne("w", ctx);
    const root = resolveScope("project", ctx);
    await writeFile(join(root.skillsDir, "w", "SKILL.md"), "# personalized\n");

    const res = await harvestOne({ slug: "w", ctx, repoDir });
    assert.equal(res.status, "harvested");
    assert.equal(res.unmodified, false);

    // Lockfile flipped to fork, source pointer retained.
    const lock = await readLockfile(root.lockfile);
    assert.equal(lock.skills.w.fork, true);
    assert.equal(lock.skills.w.source, "zingleton/skills");

    // The push landed: a fresh clone of the bare remote has the harvested skill.
    const verify = join(base, "verify");
    git(["clone", "-q", bare, verify], base);
    assert.equal(await exists(join(verify, "skills", "w", "SKILL.md")), true);
    assert.equal(await exists(join(verify, "skills", "w", ".guild-source.json")), true);

    // Update now skips it (fork).
    const report = await resolveUpdates({ ctx, deps: { fetchCatalog: async () => [{ ...entry("w"), pinnedCommit: "c2" }] } });
    assert.equal(report.updates.find((u) => u.slug === "w").outcome, "fork-skipped");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("harvesting an unmodified skill warns but proceeds", async () => {
  const { base, repoDir, ctx } = await setup();
  try {
    await installOne("u", ctx);
    const res = await harvestOne({ slug: "u", ctx, repoDir });
    assert.equal(res.status, "harvested");
    assert.equal(res.unmodified, true);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("a push failure does NOT flip the lockfile to a fork", async () => {
  const { base, repoDir, ctx } = await setup();
  try {
    await installOne("p", ctx);
    const root = resolveScope("project", ctx);
    await writeFile(join(root.skillsDir, "p", "SKILL.md"), "# edited\n");

    // Real git for add/commit; simulated rejection on push.
    const runGit = async (args, opts) => {
      if (args[0] === "push") return { code: 1, stdout: "", stderr: "remote rejected" };
      const r = spawnSync("git", args, { cwd: opts.cwd, encoding: "utf8" });
      return { code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
    };
    const res = await harvestOne({ slug: "p", ctx, repoDir, deps: { runGit } });
    assert.equal(res.status, "error");
    assert.match(res.detail, /git-push-failed/);
    assert.notEqual((await readLockfile(root.lockfile)).skills.p.fork, true);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("harvesting a slug that is not installed errors cleanly", async () => {
  const { base, repoDir, ctx } = await setup();
  try {
    const res = await harvestOne({ slug: "ghost", ctx, repoDir });
    assert.equal(res.status, "error");
    assert.match(res.detail, /not-installed/);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
