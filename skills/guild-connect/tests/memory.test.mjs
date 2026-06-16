// Unit tests for the memory U10 connect tooling: config I/O, the MCP client's
// pure parsing, the hook's transcript/recall helpers, and the setup orchestrator
// (deps injected — no network, no real filesystem outside a temp dir).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { memoryConfigPath, readMemoryConfig, writeMemoryConfig } from "../scripts/memory-config.mjs";
import {
  parseMcpBody,
  extractRecallText,
  listMemories,
  listAllMemories,
  searchMemories,
  deleteDocument,
} from "../scripts/memory-mcp.mjs";
import { blockText, extractLastExchange, buildRecallOutput } from "../scripts/memory-hook.mjs";
import { runMemorySetup, MemorySetupError } from "../scripts/memory-setup.mjs";
import { runMemory, MemoryCommandError } from "../scripts/memory.mjs";

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

// --- memory-mcp /v1 helpers (U9) --------------------------------------------
function mockFetch(responses) {
  let i = 0;
  return async () => {
    const r = responses[Math.min(i++, responses.length - 1)];
    return { status: r.status, text: async () => (typeof r.body === "string" ? r.body : JSON.stringify(r.body)) };
  };
}
const DP = { dataPlaneUrl: "https://m", bankId: "b", token: "t" };

test("listMemories maps fields and total", async () => {
  const fetch = mockFetch([{ status: 200, body: { items: [{ id: "m1", text: "x", fact_type: "experience", document_id: "d1", junk: 1 }], total: 1 } }]);
  const { items, total } = await listMemories({ ...DP, fetch });
  assert.equal(total, 1);
  assert.deepEqual(items[0], { id: "m1", text: "x", fact_type: "experience", date: null, document_id: "d1" });
});

test("listMemories throws on non-200", async () => {
  await assert.rejects(() => listMemories({ ...DP, fetch: mockFetch([{ status: 500, body: "" }]) }));
});

test("listAllMemories pages until total", async () => {
  const fetch = mockFetch([
    { status: 200, body: { items: [{ id: "a", document_id: "da" }, { id: "b", document_id: "db" }], total: 3 } },
    { status: 200, body: { items: [{ id: "c", document_id: "dc" }], total: 3 } },
  ]);
  const all = await listAllMemories({ ...DP, fetch, pageSize: 2 });
  assert.deepEqual(all.map((m) => m.id), ["a", "b", "c"]);
});

test("searchMemories returns structured matches with document_id", async () => {
  const fetch = mockFetch([{ status: 200, body: { result: { structuredContent: { results: [{ id: "m1", text: "cat is Mittens", document_id: "d1", fact_type: "experience" }] } } } }]);
  const matches = await searchMemories({ ...DP, fetch, query: "cat" });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].document_id, "d1");
});

test("deleteDocument idempotent on 200/204/404, throws on 5xx", async () => {
  for (const status of [200, 204, 404]) {
    await deleteDocument({ ...DP, fetch: mockFetch([{ status, body: "" }]), documentId: "d1" });
  }
  await assert.rejects(() => deleteDocument({ ...DP, fetch: mockFetch([{ status: 502, body: "" }]), documentId: "d1" }));
});

// --- memory.mjs command dispatch (U9) ---------------------------------------
function memDeps(over = {}) {
  return {
    readConfig: async () => ({ dataPlaneUrl: "https://m", bankId: "b" }),
    getToken: async () => ({ accessToken: "t" }),
    search: async () => [{ id: "m1", text: "cat", document_id: "d1" }],
    list: async () => ({ items: [{ id: "m1", text: "x", document_id: "d1" }], total: 1 }),
    listAll: async () => [{ id: "m1" }, { id: "m2" }],
    forget: async () => {},
    ...over,
  };
}

test("memory search returns matches", async () => {
  const r = await runMemory(memDeps(), ["search", "my", "cat"]);
  assert.equal(r.ok, true);
  assert.equal(r.count, 1);
  assert.equal(r.matches[0].document_id, "d1");
});

test("memory list returns memories", async () => {
  const r = await runMemory(memDeps(), ["list", "--limit", "5"]);
  assert.equal(r.total, 1);
  assert.equal(r.memories.length, 1);
});

test("memory export returns the whole corpus", async () => {
  const r = await runMemory(memDeps(), ["export"]);
  assert.equal(r.count, 2);
});

test("memory forget deletes the given document", async () => {
  let forgot = null;
  const r = await runMemory(memDeps({ forget: async ({ documentId }) => { forgot = documentId; } }), ["forget", "d1"]);
  assert.equal(r.forgotten, "d1");
  assert.equal(forgot, "d1");
});

test("memory forget without an id is a usage error", async () => {
  await assert.rejects(() => runMemory(memDeps(), ["forget"]), MemoryCommandError);
});

test("memory commands require setup (no config)", async () => {
  await assert.rejects(() => runMemory(memDeps({ readConfig: async () => null }), ["list"]), /set up/);
});

test("memory unknown subcommand is a usage error", async () => {
  await assert.rejects(() => runMemory(memDeps(), ["bogus"]), MemoryCommandError);
});
