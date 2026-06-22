// repo-setup.mjs unit tests — clone + seed + push for the portable personal
// repo. Pure helpers plus the runRepoSetup orchestrator with a fake filesystem
// and fake git injected (no real git, no network, no disk). node:test.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  RepoSetupError,
  SEED_FILES,
  personalCloneUrl,
  seedPlan,
  scrubGitStderr,
  runRepoSetup,
} from "../scripts/repo-setup.mjs";

// --- pure helpers -----------------------------------------------------------

test("personalCloneUrl builds the URL and tolerates a full-URL host", () => {
  assert.equal(
    personalCloneUrl({ host: "git.test", username: "guild-abc" }),
    "https://git.test/guild-abc/personal.git",
  );
  assert.equal(
    personalCloneUrl({ host: "https://git.test/foo", username: "u" }),
    "https://git.test/u/personal.git",
  );
});

test("seedPlan returns the missing seed files only", () => {
  assert.deepEqual(seedPlan([]), SEED_FILES);
  assert.deepEqual(seedPlan(["memory/MEMORY.md"]), ["skills/README.md", "Tools/README.md"]);
  assert.deepEqual(seedPlan(SEED_FILES), []);
});

test("scrubGitStderr strips URL-embedded credentials", () => {
  const dirty = "fatal: unable to access 'https://guild-x:SECRETTOKEN@git.test/u/personal.git'";
  const clean = scrubGitStderr(dirty);
  assert.doesNotMatch(clean, /SECRETTOKEN/);
  assert.match(clean, /https:\/\/\*\*\*@git\.test/);
  assert.equal(scrubGitStderr(null), "");
});

// --- orchestrator harness ---------------------------------------------------

const TARGET = "/proj";
const REPO = "/proj/repo";

// A platform-stable join (posix) injected into the orchestrator so test keys are
// deterministic regardless of host OS.
const pjoin = (...parts) => parts.join("/");

function makeWorld(scenario = {}) {
  const present = new Set();
  const calls = [];
  const logs = [];

  if (scenario.clonedAlready) {
    present.add(pjoin(REPO, ".git"));
    for (const r of scenario.existingSeeds || []) present.add(pjoin(REPO, r));
  }

  const runGit = async (args) => {
    calls.push(args.join(" "));
    const a0 = args[0];
    if (a0 === "clone") {
      if (scenario.cloneFails) {
        return {
          code: 128,
          stdout: "",
          stderr: "fatal: unable to access 'https://guild-x:SECRETTOKEN@git.test/u/personal.git'",
        };
      }
      present.add(pjoin(REPO, ".git"));
      if (scenario.cloneAddsSeeds) for (const r of SEED_FILES) present.add(pjoin(REPO, r));
      return { code: 0, stdout: "", stderr: "" };
    }
    if (a0 === "rev-parse" && args.includes("@{u}")) {
      return { code: scenario.hasUpstream ? 0 : 1, stdout: "", stderr: "" };
    }
    if (a0 === "rev-parse" && args[1] === "HEAD") {
      return { code: scenario.headExists === false ? 1 : 0, stdout: "abc123\n", stderr: "" };
    }
    if (a0 === "rev-list") {
      return { code: 0, stdout: (scenario.aheadCount ?? "0") + "\n", stderr: "" };
    }
    if (a0 === "push") {
      if (scenario.pushFails) return { code: 1, stdout: "", stderr: "remote: rejected" };
      return { code: 0, stdout: "", stderr: "" };
    }
    return { code: 0, stdout: "", stderr: "" };
  };

  const deps = {
    join: pjoin,
    pathExists: async (p) => present.has(p),
    ensureDir: async () => {},
    readSeed: async (rel) => `seed:${rel}`,
    writeSeed: async (repoDir, rel) => {
      present.add(pjoin(repoDir, rel));
    },
    runGit,
    log: (l) => logs.push(l),
  };
  return { deps, calls, logs, present };
}

const OPTS = { targetDir: TARGET, host: "git.test", username: "guild-abc" };

// --- orchestrator scenarios -------------------------------------------------

test("empty-remote first run: clone, seed all, push -u origin HEAD once", async () => {
  const w = makeWorld({ clonedAlready: false, cloneAddsSeeds: false, hasUpstream: false });
  const r = await runRepoSetup(w.deps, OPTS);

  assert.equal(r.ok, true);
  assert.equal(r.cloned, false);
  assert.deepEqual(r.seeded, SEED_FILES);
  assert.equal(r.pushed, true);

  assert.equal(w.calls.filter((c) => c.startsWith("clone ")).length, 1);
  assert.ok(w.calls.some((c) => c.startsWith("commit ")), "commits the seed");
  assert.equal(w.calls.filter((c) => c === "push -u origin HEAD").length, 1);
  assert.ok(!w.calls.some((c) => c.startsWith("pull")), "never pulls");
});

test("second machine: clone of a populated remote seeds nothing and pushes nothing", async () => {
  const w = makeWorld({ clonedAlready: false, cloneAddsSeeds: true, hasUpstream: true, aheadCount: "0" });
  const r = await runRepoSetup(w.deps, OPTS);

  assert.deepEqual(r.seeded, []);
  assert.equal(r.pushed, false);
  assert.ok(w.calls.some((c) => c.startsWith("clone ")), "clones");
  assert.ok(!w.calls.some((c) => c.startsWith("commit")), "no commit");
  assert.ok(!w.calls.some((c) => c.startsWith("push")), "no push");
  assert.ok(!w.calls.some((c) => c.startsWith("pull")), "no pull");
});

test("existing clone, fully seeded, in sync: no clone, no pull, no commit, no push", async () => {
  const w = makeWorld({
    clonedAlready: true,
    existingSeeds: SEED_FILES,
    hasUpstream: true,
    aheadCount: "0",
  });
  const r = await runRepoSetup(w.deps, OPTS);

  assert.equal(r.cloned, true);
  assert.deepEqual(r.seeded, []);
  assert.equal(r.pushed, false);
  assert.ok(!w.calls.some((c) => c.startsWith("clone")), "does not re-clone");
  assert.ok(!w.calls.some((c) => c.startsWith("pull")), "does not pull an existing clone");
  assert.ok(!w.calls.some((c) => c.startsWith("commit")), "no commit");
  assert.ok(!w.calls.some((c) => c.startsWith("push")), "no push");
});

test("existing clone with an unpushed commit: pushes without re-seeding", async () => {
  const w = makeWorld({
    clonedAlready: true,
    existingSeeds: SEED_FILES,
    hasUpstream: true,
    aheadCount: "2",
  });
  const r = await runRepoSetup(w.deps, OPTS);

  assert.deepEqual(r.seeded, []);
  assert.equal(r.pushed, true);
  assert.ok(!w.calls.some((c) => c.startsWith("commit")), "re-seeds nothing");
  assert.ok(w.calls.includes("push"), "plain push of the unpushed commit");
  assert.ok(!w.calls.includes("push -u origin HEAD"), "not a first-push");
});

test("run-twice idempotency: a second run produces no clone, commit, or push", async () => {
  // First run seeds an empty remote; mutate the world so the second run sees a
  // populated, in-sync clone (what the real filesystem would reflect).
  const w = makeWorld({ clonedAlready: false, cloneAddsSeeds: false, hasUpstream: false });
  await runRepoSetup(w.deps, OPTS);

  // Re-run against the same world, now with an upstream and nothing ahead.
  const second = makeWorld({
    clonedAlready: true,
    existingSeeds: SEED_FILES,
    hasUpstream: true,
    aheadCount: "0",
  });
  const r2 = await runRepoSetup(second.deps, OPTS);
  assert.deepEqual(r2.seeded, []);
  assert.equal(r2.pushed, false);
  assert.equal(second.calls.filter((c) => c.startsWith("clone") || c.startsWith("commit") || c.startsWith("push")).length, 0);
});

test("clone failure: throws a body-free error and the logged stderr is scrubbed of the token", async () => {
  const w = makeWorld({ clonedAlready: false, cloneFails: true });
  await assert.rejects(
    () => runRepoSetup(w.deps, OPTS),
    (err) => {
      assert.ok(err instanceof RepoSetupError);
      assert.doesNotMatch(err.message, /SECRETTOKEN/);
      return true;
    },
  );
  const joinedLogs = w.logs.join("\n");
  assert.doesNotMatch(joinedLogs, /SECRETTOKEN/, "token never appears in logs");
  assert.match(joinedLogs, /https:\/\/\*\*\*@/, "the diagnostic is scrubbed, not omitted");
});

test("missing host/username is rejected before any git runs", async () => {
  const w = makeWorld({});
  await assert.rejects(
    () => runRepoSetup(w.deps, { targetDir: TARGET, host: "", username: "" }),
    RepoSetupError,
  );
  assert.equal(w.calls.length, 0);
});
