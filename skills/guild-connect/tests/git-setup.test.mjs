// git-setup.mjs unit tests — the durable git-credential install flow. Pure
// helpers + the runGitSetup orchestrator with all dependencies injected (no real
// git, no network). node:test, mirroring the other tests in this dir.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  GitSetupError,
  parseForgejoHost,
  gitCredentialInput,
  chooseHelper,
  deviceLabel,
  runGitSetup,
} from "../scripts/git-setup.mjs";

const TOKEN = "RAW-GIT-TOKEN";
const ACCESS = { forgejoHost: "https://git.test", username: "guild-abc", token: TOKEN };

/** Build a runGit stub; `overrides` maps an args-key (joined or first arg) to a result. */
function makeRunGit(overrides = {}) {
  const calls = [];
  const runGit = async (args, opts = {}) => {
    calls.push({ args, input: opts.input });
    // `git config --global credential.helper` (get) → empty by default.
    if (args[0] === "config" && args.length === 3) return { code: 0, stdout: "", stderr: "" };
    const joined = args.join(" ");
    if (overrides[joined]) return { stdout: "", stderr: "", ...overrides[joined] };
    if (overrides[args[0]]) return { stdout: "", stderr: "", ...overrides[args[0]] };
    return { code: 0, stdout: "", stderr: "" };
  };
  return { runGit, calls };
}

function makeDeps(over = {}) {
  const logs = [];
  const { runGit, calls } = makeRunGit(over.runGit ? undefined : {});
  const deps = {
    requestToken: async () => ACCESS,
    runGit,
    commandExists: async () => true,
    platform: "darwin",
    log: (line) => logs.push(line),
    ...over,
  };
  return { deps, logs, calls };
}

// --- pure helpers -----------------------------------------------------------

test("parseForgejoHost strips scheme and path", () => {
  assert.equal(parseForgejoHost("https://git.test/foo"), "git.test");
  assert.equal(parseForgejoHost("git.test"), "git.test");
});

test("gitCredentialInput builds the exact host-scoped record", () => {
  assert.equal(
    gitCredentialInput({ host: "git.test", username: "u", token: "t" }),
    "protocol=https\nhost=git.test\nusername=u\npassword=t\n\n",
  );
});

test("chooseHelper picks per platform; linux without secret service → plaintext store", () => {
  assert.deepEqual(chooseHelper("win32", {}), { helper: "manager", plaintextWarning: false });
  assert.deepEqual(chooseHelper("darwin", {}), { helper: "osxkeychain", plaintextWarning: false });
  assert.deepEqual(chooseHelper("linux", { hasSecretService: true }), {
    helper: "libsecret",
    plaintextWarning: false,
  });
  assert.deepEqual(chooseHelper("linux", { hasSecretService: false }), {
    helper: "store",
    plaintextWarning: true,
  });
  assert.deepEqual(chooseHelper("freebsd", {}), { helper: "store", plaintextWarning: true });
});

test("deviceLabel slugifies and falls back to default", () => {
  assert.equal(deviceLabel("Andy's MacBook Pro"), "andy-s-macbook-pro");
  assert.equal(deviceLabel("!!!"), "default");
});

// --- runGitSetup ------------------------------------------------------------

test("requests a token and invokes git credential approve with the host-scoped stdin payload", async () => {
  const { deps, calls } = makeDeps();
  const result = await runGitSetup(deps, {});
  assert.equal(result.ok, true);
  const approve = calls.find((c) => c.args[0] === "credential" && c.args[1] === "approve");
  assert.ok(approve, "git credential approve was called");
  assert.equal(
    approve.input,
    "protocol=https\nhost=git.test\nusername=guild-abc\npassword=RAW-GIT-TOKEN\n\n",
  );
});

test("never writes the token to logs or the returned result", async () => {
  const { deps, logs } = makeDeps();
  const result = await runGitSetup(deps, {});
  assert.ok(!JSON.stringify(result).includes(TOKEN));
  assert.ok(!logs.join("\n").includes(TOKEN));
});

test("surfaces an actionable error when git is missing from PATH", async () => {
  const { runGit } = makeRunGit({ "--version": { code: 127 } });
  const { deps } = makeDeps({ runGit });
  await assert.rejects(runGitSetup(deps, {}), GitSetupError);
});

test("surfaces an actionable error when the credential helper can't be configured", async () => {
  const calls = [];
  const runGit = async (args, opts = {}) => {
    calls.push({ args, input: opts.input });
    if (args[0] === "config" && args.length === 4) return { code: 1, stdout: "", stderr: "" }; // set fails
    if (args[0] === "config") return { code: 0, stdout: "", stderr: "" }; // get → empty
    return { code: 0, stdout: "", stderr: "" };
  };
  const { deps } = makeDeps({ runGit });
  await assert.rejects(runGitSetup(deps, {}), GitSetupError);
});

test("verify step: a failing git ls-remote surfaces an actionable error, not success", async () => {
  const { runGit } = makeRunGit({ "ls-remote": { code: 1 } });
  const { deps } = makeDeps({ runGit });
  await assert.rejects(runGitSetup(deps, {}), /test git fetch failed/);
});

test("a failing git credential approve surfaces an actionable error", async () => {
  const { runGit } = makeRunGit({ "credential approve": { code: 1 } });
  const { deps } = makeDeps({ runGit });
  await assert.rejects(runGitSetup(deps, {}), /rejected the credential/);
});

test("linux without secret service selects the store fallback and warns about plaintext", async () => {
  const { runGit, calls } = makeRunGit();
  const { deps, logs } = makeDeps({
    runGit,
    platform: "linux",
    commandExists: async () => false,
  });
  const result = await runGitSetup(deps, {});
  assert.equal(result.helper, "store");
  assert.equal(result.plaintextWarning, true);
  assert.ok(
    calls.some((c) => c.args.join(" ") === "config --global credential.helper store"),
  );
  assert.ok(logs.join("\n").includes("PLAINTEXT"));
});
