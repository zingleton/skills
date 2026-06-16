// Unit tests for the memory U10 connect tooling: config I/O, the MCP client's
// pure parsing, the hook's transcript/recall helpers, and the setup orchestrator
// (deps injected — no network, no real filesystem outside a temp dir).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { memoryConfigPath, readMemoryConfig, writeMemoryConfig } from "../scripts/memory-config.mjs";
import { parseMcpBody, extractRecallText } from "../scripts/memory-mcp.mjs";
import { blockText, extractLastExchange, buildRecallOutput } from "../scripts/memory-hook.mjs";
import { runMemorySetup, MemorySetupError } from "../scripts/memory-setup.mjs";

// --- memory-config (isolated via XDG_CONFIG_HOME) ---------------------------
async function withTempConfig(fn) {
  const dir = await mkdtemp(join(tmpdir(), "guild-mem-"));
  const prev = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = dir;
  try {
    await fn(dir);
  } finally {
    if (prev === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = prev;
    await rm(dir, { recursive: true, force: true });
  }
}

test("memory-config: write then read round-trips and trims trailing slashes", async () => {
  await withTempConfig(async () => {
    const p = await writeMemoryConfig({ dataPlaneUrl: "https://memory.example.com//", bankId: "guild-abc" });
    assert.equal(p, memoryConfigPath());
    assert.deepEqual(await readMemoryConfig(), { dataPlaneUrl: "https://memory.example.com", bankId: "guild-abc" });
  });
});

test("memory-config: absent file → null (capture stays off)", async () => {
  await withTempConfig(async () => {
    assert.equal(await readMemoryConfig(), null);
  });
});

test("memory-config: malformed / incomplete → null", async () => {
  await withTempConfig(async (dir) => {
    const d = join(dir, "ai-power-guild");
    await mkdir(d, { recursive: true });
    await writeFile(join(d, "memory.json"), "{ not json");
    assert.equal(await readMemoryConfig(), null);
    await writeFile(join(d, "memory.json"), JSON.stringify({ dataPlaneUrl: "https://x" })); // no bankId
    assert.equal(await readMemoryConfig(), null);
  });
});

// --- memory-mcp pure parsing ------------------------------------------------
test("parseMcpBody: bare JSON and SSE-framed", () => {
  assert.deepEqual(parseMcpBody('{"a":1}'), { a: 1 });
  assert.deepEqual(parseMcpBody('event: message\ndata: {"a":2}\n\n'), { a: 2 });
});

test("extractRecallText: structuredContent, content-JSON-string, dedupe, empty", () => {
  assert.deepEqual(
    extractRecallText({ structuredContent: { results: [{ text: "fact A" }, { text: "fact B" }] } }),
    ["fact A", "fact B"],
  );
  assert.deepEqual(
    extractRecallText({ content: [{ type: "text", text: '{"results":[{"text":"fact C"},{"text":"fact C"}]}' }] }),
    ["fact C"], // deduped
  );
  assert.deepEqual(extractRecallText({ structuredContent: { results: [] } }), []);
});

// --- memory-hook pure helpers -----------------------------------------------
test("blockText: string, text-block array, ignores non-text blocks", () => {
  assert.equal(blockText("hello"), "hello");
  assert.equal(
    blockText([{ type: "text", text: "a" }, { type: "tool_use", id: "x" }, { type: "text", text: "b" }]),
    "a\nb",
  );
  assert.equal(blockText(undefined), "");
});

test("extractLastExchange: builds latest user+assistant from JSONL, tolerant of junk", () => {
  const jsonl = [
    JSON.stringify({ message: { role: "user", content: "old q" } }),
    "not json",
    JSON.stringify({ message: { role: "assistant", content: [{ type: "text", text: "old a" }] } }),
    JSON.stringify({ message: { role: "user", content: "what is my deploy day?" } }),
    JSON.stringify({ type: "tool_result", message: { role: "tool", content: "ignored" } }),
    JSON.stringify({ message: { role: "assistant", content: [{ type: "text", text: "Fridays." }] } }),
  ].join("\n");
  assert.equal(extractLastExchange(jsonl), "User: what is my deploy day?\n\nAssistant: Fridays.");
  assert.equal(extractLastExchange(""), "");
  assert.equal(extractLastExchange("garbage\nlines"), "");
});

test("buildRecallOutput: facts → UserPromptSubmit additionalContext; empty → null", () => {
  assert.equal(buildRecallOutput([]), null);
  const out = buildRecallOutput(["deploys on Fridays"]);
  assert.equal(out.hookSpecificOutput.hookEventName, "UserPromptSubmit");
  assert.match(out.hookSpecificOutput.additionalContext, /deploys on Fridays/);
});

// --- memory-setup orchestrator (deps injected) ------------------------------
function setupDeps(over = {}) {
  const calls = { wrote: null, verified: null, logged: [] };
  const deps = {
    requestAccess: async () => ({ dataPlaneUrl: "https://memory.example.com/", bankId: "guild-xyz" }),
    writeConfig: async (c) => { calls.wrote = c; return "/tmp/memory.json"; },
    getToken: async () => ({ accessToken: "tok" }),
    verifyRecall: async (a) => { calls.verified = a; return []; },
    log: (l) => calls.logged.push(l),
    ...over,
  };
  return { deps, calls };
}

test("runMemorySetup: provisions, writes trimmed config, verifies, returns endpoint", async () => {
  const { deps, calls } = setupDeps();
  const res = await runMemorySetup(deps);
  assert.deepEqual(res, { ok: true, dataPlaneUrl: "https://memory.example.com", bankId: "guild-xyz" });
  assert.deepEqual(calls.wrote, { dataPlaneUrl: "https://memory.example.com", bankId: "guild-xyz" });
  assert.equal(calls.verified.token, "tok");
  assert.equal(calls.verified.bankId, "guild-xyz");
});

test("runMemorySetup: missing endpoint fields → MemorySetupError, no write", async () => {
  const { deps, calls } = setupDeps({ requestAccess: async () => ({ bankId: "guild-xyz" }) });
  await assert.rejects(() => runMemorySetup(deps), MemorySetupError);
  assert.equal(calls.wrote, null);
});

test("runMemorySetup: a failed verify surfaces a clear error", async () => {
  const { deps } = setupDeps({ verifyRecall: async () => { throw new Error("network"); } });
  await assert.rejects(() => runMemorySetup(deps), /test connection failed/);
});
