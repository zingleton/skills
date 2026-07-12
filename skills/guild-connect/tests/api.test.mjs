// api.mjs unit tests — the 401 → single-refresh-retry → ReconnectRequired
// discipline, plus the redaction guarantee: Authorization headers and raw
// response bodies never leak into thrown messages or the console. Ported from
// skill-credentials.test.ts §3. Every fetch is injected — nothing leaves the
// process.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, access, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ApiError, getJson, ReconnectRequired, parseJsonArg } from "../scripts/api.mjs";
import { writeCredentials } from "../scripts/credentials.mjs";
import { SITE_URL } from "../scripts/config.mjs";
import { sampleCreds, jsonResponse, gotrueRefreshOk } from "./helpers.mjs";

const SITE = SITE_URL;

let tmpBase;
let caseSeq = 0;

before(async () => {
  tmpBase = await mkdtemp(join(tmpdir(), "guild-api-test-"));
});

after(async () => {
  await rm(tmpBase, { recursive: true, force: true });
});

function freshCredPath() {
  const p = join(tmpBase, `case-${caseSeq++}`, "ai-power-guild", "credentials.json");
  process.env.AI_POWER_GUILD_CREDENTIALS_PATH = p;
  return p;
}

test("401 → exactly one refresh → retry succeeds with the rotated token", async () => {
  freshCredPath();
  await writeCredentials(sampleCreds());
  const seen = [];
  const fetchSpy = async (input, init) => {
    const u = String(input);
    const headers = new Headers(init?.headers);
    seen.push({ url: u, auth: headers.get("authorization") });
    if (u.startsWith(SITE)) {
      const isRetry = headers.get("authorization") === "Bearer unit-test-access-2";
      return isRetry
        ? jsonResponse(200, { ok: true, profile: null })
        : jsonResponse(401, { error: "Unauthorized" });
    }
    return gotrueRefreshOk(2);
  };
  const out = await getJson("/api/user-profile", { fetch: fetchSpy });
  assert.deepEqual(out, { ok: true, profile: null });
  const apiCalls = seen.filter((s) => s.url.startsWith(SITE));
  const refreshCalls = seen.filter((s) => s.url.includes("/auth/v1/token"));
  assert.equal(apiCalls.length, 2);
  assert.equal(refreshCalls.length, 1);
  assert.equal(apiCalls[0].auth, "Bearer unit-test-access-1");
  assert.equal(apiCalls[1].auth, "Bearer unit-test-access-2");
});

test("401 even after refresh → credentials cleared + ReconnectRequired, no token leak, no console output", async () => {
  const p = freshCredPath();
  await writeCredentials(sampleCreds());
  const realLog = console.log;
  const realError = console.error;
  const realWarn = console.warn;
  let consoleCalls = 0;
  console.log = console.error = console.warn = () => {
    consoleCalls++;
  };
  try {
    const fetchSpy = async (input) => {
      const u = String(input);
      if (u.startsWith(SITE)) return jsonResponse(401, { error: "Unauthorized" });
      return gotrueRefreshOk(2);
    };
    const err = await getJson("/api/user-profile", { fetch: fetchSpy }).catch((e) => e);
    assert.ok(err instanceof ReconnectRequired);
    assert.match(String(err.message), /connect/i);
    for (const banned of ["unit-test-access", "unit-test-refresh", "Bearer "]) {
      assert.ok(!String(err.message).includes(banned));
    }
    await assert.rejects(access(p)); // file cleared
    assert.equal(consoleCalls, 0);
  } finally {
    console.log = realLog;
    console.error = realError;
    console.warn = realWarn;
  }
});

test("non-2xx with a JSON {error} body → ApiError carrying ONLY the error field", async () => {
  freshCredPath();
  await writeCredentials(sampleCreds());
  const fetchSpy = async () =>
    jsonResponse(409, {
      error: "You already have a submission. Edit it instead.",
      reason: "already_has_submission",
      internal_detail: "raw-secret-body-content",
    });
  const err = await getJson("/api/profile", { fetch: fetchSpy }).catch((e) => e);
  assert.ok(err instanceof ApiError);
  assert.equal(err.status, 409);
  assert.equal(err.reason, "already_has_submission");
  assert.equal(err.message, "You already have a submission. Edit it instead.");
  assert.ok(!String(err.message).includes("raw-secret-body-content"));
});

test("a duplicate-conflict 409 passes `existing` through, whitelisted to string scalars", async () => {
  freshCredPath();
  await writeCredentials(sampleCreds());
  const fetchSpy = async () =>
    jsonResponse(409, {
      error: "You published an item with this title moments ago.",
      reason: "duplicate_title",
      existing: {
        id: "11111111-1111-1111-1111-111111111111",
        slug: "kept-too",
        count: 5, // non-string scalar → stripped
        nested: { secret: "raw-body-material" }, // nested → stripped
      },
    });
  const err = await getJson("/api/content/manage", { fetch: fetchSpy }).catch((e) => e);
  assert.ok(err instanceof ApiError);
  assert.deepEqual(err.existing, {
    id: "11111111-1111-1111-1111-111111111111",
    slug: "kept-too",
  });
  assert.ok(!JSON.stringify(err.existing).includes("raw-body-material"));
});

test("an off-contract `existing` (non-object or no string fields) becomes null", async () => {
  freshCredPath();
  await writeCredentials(sampleCreds());
  const asString = async () =>
    jsonResponse(409, { error: "x", existing: "not-an-object" });
  const err1 = await getJson("/api/profile", { fetch: asString }).catch((e) => e);
  assert.equal(err1.existing, null);

  freshCredPath();
  await writeCredentials(sampleCreds());
  const noStrings = async () =>
    jsonResponse(409, { error: "x", existing: { n: 1, deep: {} } });
  const err2 = await getJson("/api/profile", { fetch: noStrings }).catch((e) => e);
  assert.equal(err2.existing, null);
});

test("request timeout → ApiError 'Request timed out. Try again.' (no credential clearing)", async () => {
  const p = freshCredPath();
  await writeCredentials(sampleCreds());
  const fetchSpy = async (input) => {
    const u = String(input);
    if (u.startsWith(SITE)) throw new DOMException("The operation timed out.", "TimeoutError");
    return gotrueRefreshOk(2);
  };
  const err = await getJson("/api/user-profile", { fetch: fetchSpy }).catch((e) => e);
  assert.ok(err instanceof ApiError);
  assert.equal(err.message, "Request timed out. Try again.");
  await access(p); // survives — resolves without throwing
});

test("non-JSON error body is never echoed — generic status message only", async () => {
  freshCredPath();
  await writeCredentials(sampleCreds());
  const fetchSpy = async () =>
    new Response("<html>gateway exploded secret-trace</html>", { status: 502 });
  const err = await getJson("/api/profile", { fetch: fetchSpy }).catch((e) => e);
  assert.ok(err instanceof ApiError);
  assert.equal(err.status, 502);
  assert.ok(!String(err.message).includes("secret-trace"));
});

// --- parseJsonArg: inline | file path | stdin (the permission-prompt dodge) ---

test("parseJsonArg accepts inline JSON, a file path, and rejects bad input", async () => {
  // inline — backward compatible
  assert.deepEqual(parseJsonArg('{"a":1}', "usage"), { a: 1 });

  // file path — what the SKILLs pass to avoid a shell-quoted '{...}' argument
  const f = join(tmpBase, "cfg.json");
  await writeFile(f, '{"targetDir":"/x","name":"Ada"}');
  assert.deepEqual(parseJsonArg(f, "usage"), { targetDir: "/x", name: "Ada" });

  // a non-existent path string is treated as inline JSON and fails clearly
  assert.throws(() => parseJsonArg("missing-config.json", "usage-line"), /valid JSON/);
  // empty / array / null still rejected with the usage line
  assert.throws(() => parseJsonArg("", "usage-line"), /usage-line/);
  assert.throws(() => parseJsonArg("[1]", "usage-line"), /JSON object/);
});

test("parseJsonArg reads a file whose JSON contains shell-significant chars", async () => {
  // The whole point: braces, quotes, semicolons, ampersands live in the FILE,
  // never on the command line where the permission analyzer would flag them.
  const f = join(tmpBase, "cfg2.json");
  await writeFile(f, JSON.stringify({ aboutMe: 'I "build" things; & more', links: [{ url: "https://x" }] }));
  const out = parseJsonArg(f, "usage");
  assert.equal(out.aboutMe, 'I "build" things; & more');
  assert.equal(out.links[0].url, "https://x");
});
