// doctor.mjs unit tests — the preflight environment check. Pure helpers plus
// the runDoctor orchestrator with deps injected (no real git, no spawn).
// node:test, mirroring the other tests in this dir.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MIN_NODE_MAJOR,
  parseNodeVersion,
  checkEnv,
  runDoctor,
} from "../scripts/doctor.mjs";

// --- parseNodeVersion -------------------------------------------------------

test("parseNodeVersion extracts the major from common shapes", () => {
  assert.equal(parseNodeVersion("v18.19.0"), 18);
  assert.equal(parseNodeVersion("v20.0.0"), 20);
  assert.equal(parseNodeVersion("20.1.0"), 20);
  assert.equal(parseNodeVersion("v8.17.0"), 8);
});

test("parseNodeVersion returns null for unparseable input", () => {
  assert.equal(parseNodeVersion(""), null);
  assert.equal(parseNodeVersion("nonsense"), null);
  assert.equal(parseNodeVersion(undefined), null);
  assert.equal(parseNodeVersion(null), null);
});

// --- checkEnv ---------------------------------------------------------------

test("checkEnv passes when Node >= min and git present", () => {
  const r = checkEnv({ nodeVersion: 18, gitExists: true });
  assert.equal(r.ok, true);
  assert.equal(r.checks.length, 2);
  for (const c of r.checks) {
    assert.equal(c.ok, true);
    assert.equal(c.fix, null);
  }
});

test("checkEnv fails the node check on too-old Node but still evaluates git", () => {
  const r = checkEnv({ nodeVersion: 16, gitExists: true });
  assert.equal(r.ok, false);
  const node = r.checks.find((c) => c.name === "node");
  const git = r.checks.find((c) => c.name === "git");
  assert.equal(node.ok, false);
  assert.match(node.fix, /Node 18\+ is required/);
  assert.match(node.fix, /v16/);
  // The fix offers the agent-install path AND keeps the manual-install URL as a
  // fallback, and stays agent-neutral so it reads correctly at a bare terminal too.
  assert.match(node.fix, /install it for you/);
  assert.match(node.fix, /or install the latest LTS yourself/);
  assert.match(node.fix, /https:\/\/nodejs\.org/);
  // git was still evaluated and reported ok — one failing check doesn't skip the other.
  assert.equal(git.ok, true);
  assert.equal(git.fix, null);
});

test("checkEnv fails the git check with a fix string when git is absent", () => {
  const r = checkEnv({ nodeVersion: 20, gitExists: false });
  assert.equal(r.ok, false);
  const git = r.checks.find((c) => c.name === "git");
  assert.equal(git.ok, false);
  assert.match(git.fix, /git was not found/);
  // Same agent-install-with-manual-fallback shape as the node fix.
  assert.match(git.fix, /install it for you/);
  assert.match(git.fix, /or install it yourself/);
  assert.match(git.fix, /https:\/\/git-scm\.com\/downloads/);
});

test("checkEnv reports an unrecognized version when nodeVersion is null", () => {
  const r = checkEnv({ nodeVersion: null, gitExists: true });
  assert.equal(r.ok, false);
  const node = r.checks.find((c) => c.name === "node");
  assert.equal(node.ok, false);
  assert.match(node.fix, /unrecognized version/);
});

test("MIN_NODE_MAJOR is the documented baseline", () => {
  assert.equal(MIN_NODE_MAJOR, 18);
  // Boundary: exactly the minimum passes, one below fails.
  assert.equal(checkEnv({ nodeVersion: MIN_NODE_MAJOR, gitExists: true }).ok, true);
  assert.equal(checkEnv({ nodeVersion: MIN_NODE_MAJOR - 1, gitExists: true }).ok, false);
});

// --- runDoctor (deps injected) ----------------------------------------------

test("runDoctor integrates the injected git probe", async () => {
  const ok = await runDoctor({ nodeVersion: 18, gitExists: async () => true });
  assert.equal(ok.ok, true);

  const noGit = await runDoctor({ nodeVersion: 18, gitExists: async () => false });
  assert.equal(noGit.ok, false);
  assert.equal(noGit.checks.find((c) => c.name === "git").ok, false);
});

test("result is JSON-serializable and carries no token/secret fields", () => {
  const r = checkEnv({ nodeVersion: 16, gitExists: false });
  const json = JSON.stringify(r);
  assert.doesNotThrow(() => JSON.parse(json));
  assert.doesNotMatch(json.toLowerCase(), /token|secret|password|authorization/);
});
