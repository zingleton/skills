// guild-skills: lockfile v2 tests (U5, R11) — roundtrip, fail-closed reads,
// content hashing, and local-modification state (R20 signal).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  readLockfile,
  writeLockfile,
  upsertEntry,
  removeEntry,
  hashSkillDir,
  localState,
  LockfileError,
} from "../scripts/lockfile.mjs";

async function tmp() {
  return mkdtemp(join(tmpdir(), "guild-lock-"));
}

test("missing lockfile reads as the empty state", async () => {
  const dir = await tmp();
  try {
    const lock = await readLockfile(join(dir, "skills-lock.json"));
    assert.deepEqual(lock.skills, {});
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("corrupt JSON and wrong-shape lockfiles fail closed (LockfileError)", async () => {
  const dir = await tmp();
  const p = join(dir, "skills-lock.json");
  try {
    await writeFile(p, "{not json");
    await assert.rejects(() => readLockfile(p), LockfileError);
    await writeFile(p, JSON.stringify({ version: 2 })); // no skills object
    await assert.rejects(() => readLockfile(p), LockfileError);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("write/read roundtrip; upsert and remove entries", async () => {
  const dir = await tmp();
  const p = join(dir, "skills-lock.json");
  try {
    await writeLockfile(p, { skills: {} });
    await upsertEntry(p, "foo", { source: "a/b", pinnedCommit: "sha1", fork: false });
    let lock = await readLockfile(p);
    assert.equal(lock.version, 2);
    assert.equal(lock.skills.foo.source, "a/b");

    await upsertEntry(p, "bar", { source: "c/d", pinnedCommit: "sha2", fork: true });
    assert.equal(Object.keys((await readLockfile(p)).skills).length, 2);

    assert.equal(await removeEntry(p, "foo"), true);
    assert.equal(await removeEntry(p, "foo"), false); // already gone
    lock = await readLockfile(p);
    assert.deepEqual(Object.keys(lock.skills), ["bar"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("hashSkillDir is stable, changes with content, and is null when missing", async () => {
  const dir = await tmp();
  try {
    const skill = join(dir, "s");
    await mkdir(join(skill, "scripts"), { recursive: true });
    await writeFile(join(skill, "SKILL.md"), "# s\n");
    await writeFile(join(skill, "scripts", "run.mjs"), "// a\n");

    const h1 = await hashSkillDir(skill);
    assert.equal(await hashSkillDir(skill), h1, "stable across reads");

    await writeFile(join(skill, "scripts", "run.mjs"), "// changed\n");
    assert.notEqual(await hashSkillDir(skill), h1, "changes when a file changes");

    assert.equal(await hashSkillDir(join(dir, "missing")), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("localState reports clean / modified / missing against a recorded hash", async () => {
  const dir = await tmp();
  try {
    const skill = join(dir, "s");
    await mkdir(skill, { recursive: true });
    await writeFile(join(skill, "SKILL.md"), "# s\n");
    const recorded = await hashSkillDir(skill);

    assert.equal(await localState(skill, recorded), "clean");
    await writeFile(join(skill, "SKILL.md"), "# edited\n");
    assert.equal(await localState(skill, recorded), "modified");
    assert.equal(await localState(join(dir, "gone"), recorded), "missing");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
