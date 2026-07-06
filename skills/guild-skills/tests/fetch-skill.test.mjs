// guild-skills: fetch-skill tests (U5). Pure path/URL checks plus real git
// fetches against a LOCAL source repo (no network) covering the three outcomes:
// success, missing-path, and unreachable.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile, access } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fetchSkillAtPin, FetchError, githubUrl, isSafeSkillPath } from "../scripts/fetch-skill.mjs";

const exists = (p) => access(p).then(() => true, () => false);

test("isSafeSkillPath rejects traversal, absolute, backslash, empty", () => {
  assert.equal(isSafeSkillPath("skills/foo"), true);
  assert.equal(isSafeSkillPath("skills/../etc"), false);
  assert.equal(isSafeSkillPath("/etc/passwd"), false);
  assert.equal(isSafeSkillPath("skills\\foo"), false);
  assert.equal(isSafeSkillPath(""), false);
});

test("githubUrl builds a GitHub URL but passes local paths through", () => {
  assert.equal(githubUrl("owner/repo"), "https://github.com/owner/repo.git");
  assert.equal(githubUrl("/tmp/local"), "/tmp/local");
});

// Build a real local git repo with a skill dir; return { repoDir, sha }.
async function makeSourceRepo() {
  const repoDir = await mkdtemp(join(tmpdir(), "guild-src-repo-"));
  const git = (...args) => {
    const r = spawnSync("git", args, { cwd: repoDir, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
    return r.stdout.trim();
  };
  git("init", "-q");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  await mkdir(join(repoDir, "skills", "foo"), { recursive: true });
  await writeFile(join(repoDir, "skills", "foo", "SKILL.md"), "# foo\n");
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  const sha = git("rev-parse", "HEAD");
  return { repoDir, sha };
}

test("fetchSkillAtPin copies the pinned skill subtree into the stage dir", async () => {
  const { repoDir, sha } = await makeSourceRepo();
  const work = await mkdtemp(join(tmpdir(), "guild-work-"));
  const stageParent = await mkdtemp(join(tmpdir(), "guild-stage-"));
  const stageDir = join(stageParent, "foo");
  try {
    await fetchSkillAtPin({ repo: repoDir, skillPath: "skills/foo", commit: sha, stageDir, workDir: work });
    assert.equal(await exists(join(stageDir, "SKILL.md")), true);
    assert.equal((await readFile(join(stageDir, "SKILL.md"), "utf8")).trim(), "# foo");
    assert.equal(await exists(work), false, "temp clone is removed");
  } finally {
    await rm(repoDir, { recursive: true, force: true });
    await rm(stageParent, { recursive: true, force: true });
    await rm(work, { recursive: true, force: true });
  }
});

test("a missing skill path at a valid pin is FetchError('missing-path')", async () => {
  const { repoDir, sha } = await makeSourceRepo();
  const work = await mkdtemp(join(tmpdir(), "guild-work-"));
  const stageParent = await mkdtemp(join(tmpdir(), "guild-stage-"));
  try {
    await assert.rejects(
      () => fetchSkillAtPin({ repo: repoDir, skillPath: "skills/nope", commit: sha, stageDir: join(stageParent, "x"), workDir: work }),
      (e) => e instanceof FetchError && e.kind === "missing-path",
    );
  } finally {
    await rm(repoDir, { recursive: true, force: true });
    await rm(stageParent, { recursive: true, force: true });
    await rm(work, { recursive: true, force: true });
  }
});

test("an unfetchable commit is FetchError('unreachable')", async () => {
  const { repoDir } = await makeSourceRepo();
  const work = await mkdtemp(join(tmpdir(), "guild-work-"));
  const stageParent = await mkdtemp(join(tmpdir(), "guild-stage-"));
  try {
    await assert.rejects(
      () => fetchSkillAtPin({ repo: repoDir, skillPath: "skills/foo", commit: "0".repeat(40), stageDir: join(stageParent, "x"), workDir: work }),
      (e) => e instanceof FetchError && e.kind === "unreachable",
    );
  } finally {
    await rm(repoDir, { recursive: true, force: true });
    await rm(stageParent, { recursive: true, force: true });
    await rm(work, { recursive: true, force: true });
  }
});

test("an unsafe skill path is refused before any git runs", async () => {
  await assert.rejects(
    () => fetchSkillAtPin({ repo: "o/r", skillPath: "../../etc", commit: "abc", stageDir: "/tmp/x", workDir: "/tmp/y" }),
    (e) => e instanceof FetchError && e.kind === "missing-path",
  );
});
