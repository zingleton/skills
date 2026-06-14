// credentials.mjs unit tests — the shared credential-store contract: path
// override, atomic writes, the sidecar lock, and rotation-safe refresh.
// Ported from skill-credentials.test.ts §1, §2, §2b. Pure Node against a temp
// dir (AI_POWER_GUILD_CREDENTIALS_PATH override); NO real network — refresh is
// exercised through an injected fetch. Unix-permission and chmod-based
// write-failure assertions are gated on non-Windows (see helpers.checkModes).

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, stat, utimes, chmod, readdir, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

import {
  ReconnectRequired,
  StaleSkillError,
  credentialsPath,
  readCredentials,
  writeCredentials,
  clearCredentials,
  getValidAccessToken,
  withLock,
} from "../scripts/credentials.mjs";
import {
  nowSecs,
  sampleCreds,
  jsonResponse,
  gotrueRefreshOk,
  mockFn,
  checkModes,
} from "./helpers.mjs";

let tmpBase;
let caseSeq = 0;

before(async () => {
  tmpBase = await mkdtemp(join(tmpdir(), "guild-cred-test-"));
});

after(async () => {
  await rm(tmpBase, { recursive: true, force: true });
});

/** Fresh credential path per test, via the env override the contract guarantees. */
function freshCredPath() {
  const p = join(tmpBase, `case-${caseSeq++}`, "ai-power-guild", "credentials.json");
  process.env.AI_POWER_GUILD_CREDENTIALS_PATH = p;
  return p;
}

beforeEach(() => {
  // Each test calls freshCredPath() itself; this just guarantees no stale env
  // bleeds between files if one forgets.
  delete process.env.AI_POWER_GUILD_CREDENTIALS_PATH;
});

// --- 1. Credential store ----------------------------------------------------

test("write → re-read round-trips the exact credential shape", async () => {
  const p = freshCredPath();
  const creds = sampleCreds();
  await writeCredentials(creds);
  assert.equal(credentialsPath(), p);
  assert.deepEqual(await readCredentials(), creds);
});

test("missing or corrupt file reads as null", async () => {
  const p = freshCredPath();
  assert.equal(await readCredentials(), null);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, "{not json", { mode: 0o600 });
  assert.equal(await readCredentials(), null);
});

test("clearCredentials removes the file and tolerates a missing one", async () => {
  const p = freshCredPath();
  await writeCredentials(sampleCreds());
  await clearCredentials();
  await assert.rejects(access(p));
  await clearCredentials(); // second clear is a no-op, not an error
});

test(
  "file is 0600 and the directory 0700",
  { skip: checkModes ? false : "POSIX permission bits not meaningful on Windows" },
  async () => {
    const p = freshCredPath();
    await writeCredentials(sampleCreds());
    assert.equal((await stat(p)).mode & 0o777, 0o600);
    assert.equal((await stat(dirname(p)).then((s) => s.mode)) & 0o777, 0o700);
  },
);

test(
  "atomic write: a failed write leaves the old file intact and no tmp litter",
  { skip: checkModes ? false : "chmod write-block not enforceable on Windows" },
  async () => {
    const p = freshCredPath();
    const original = sampleCreds();
    await writeCredentials(original);
    await chmod(dirname(p), 0o500); // unwritable → tmp-file write fails
    try {
      await assert.rejects(
        writeCredentials(sampleCreds({ access_token: "unit-test-access-9" })),
      );
    } finally {
      await chmod(dirname(p), 0o700);
    }
    assert.deepEqual(await readCredentials(), original);
    const litter = (await readdir(dirname(p))).filter((f) => f !== "credentials.json");
    assert.deepEqual(litter, []);
  },
);

// --- 2. Lock + refresh discipline ------------------------------------------

test("two concurrent calls with a fresh token: both resolve, zero refresh calls", async () => {
  freshCredPath();
  await writeCredentials(sampleCreds());
  const fetchSpy = mockFn();
  const [a, b] = await Promise.all([
    getValidAccessToken({ fetch: fetchSpy }),
    getValidAccessToken({ fetch: fetchSpy }),
  ]);
  assert.equal(a.accessToken, "unit-test-access-1");
  assert.equal(b.accessToken, "unit-test-access-1");
  assert.equal(fetchSpy.calls, 0);
});

test("two concurrent calls with an expiring token: exactly ONE refresh; second reuses it", async () => {
  freshCredPath();
  await writeCredentials(sampleCreds({ expires_at: nowSecs() + 10 })); // < 60s margin
  const fetchSpy = mockFn(async () => {
    await new Promise((r) => setTimeout(r, 80));
    return gotrueRefreshOk(2);
  });
  const [a, b] = await Promise.all([
    getValidAccessToken({ fetch: fetchSpy }),
    getValidAccessToken({ fetch: fetchSpy }),
  ]);
  assert.equal(fetchSpy.calls, 1);
  assert.equal(a.accessToken, "unit-test-access-2");
  assert.equal(b.accessToken, "unit-test-access-2");
  assert.equal((await readCredentials())?.refresh_token, "unit-test-refresh-2");
});

test("a stale lock (mtime older than the threshold) is broken", async () => {
  const p = freshCredPath();
  await writeCredentials(sampleCreds());
  const lockPath = `${p}.lock`;
  await writeFile(lockPath, "999999:deadbeefdeadbeef", { mode: 0o600 });
  const old = new Date(Date.now() - 60_000);
  await utimes(lockPath, old, old);
  const got = await getValidAccessToken({ fetch: mockFn() });
  assert.equal(got.accessToken, "unit-test-access-1");
});

test("a live lock that never releases produces a clear timeout error", async () => {
  const p = freshCredPath();
  await writeCredentials(sampleCreds());
  await writeFile(`${p}.lock`, "999999:feedfacefeedface", { mode: 0o600 });
  await assert.rejects(
    getValidAccessToken({
      fetch: mockFn(),
      lockTimeoutMs: 400,
      lockRetryMs: 50,
      lockStaleMs: 60_000,
    }),
    /lock/i,
  );
});

test("invalid_grant on refresh → file cleared + ReconnectRequired", async () => {
  const p = freshCredPath();
  await writeCredentials(sampleCreds({ expires_at: nowSecs() - 10 }));
  const fetchSpy = mockFn(async () =>
    jsonResponse(400, {
      code: 400,
      error_code: "refresh_token_not_found",
      msg: "Invalid Refresh Token: Refresh Token Not Found",
    }),
  );
  await assert.rejects(getValidAccessToken({ fetch: fetchSpy }), ReconnectRequired);
  await assert.rejects(access(p));
});

test("invalid_grant but a sibling already rotated the file → sibling's token wins, file kept", async () => {
  freshCredPath();
  await writeCredentials(sampleCreds({ expires_at: nowSecs() - 10 }));
  const fetchSpy = mockFn(async () => {
    // A "sibling process" rotates the file before GoTrue answers (re-read-once rule).
    await writeCredentials(
      sampleCreds({
        access_token: "unit-test-access-3",
        refresh_token: "unit-test-refresh-3",
        expires_at: nowSecs() + 3600,
      }),
    );
    return jsonResponse(400, {
      code: 400,
      error_code: "refresh_token_not_found",
      msg: "Invalid Refresh Token: Refresh Token Not Found",
    });
  });
  const got = await getValidAccessToken({ fetch: fetchSpy });
  assert.equal(got.accessToken, "unit-test-access-3");
  assert.equal((await readCredentials())?.refresh_token, "unit-test-refresh-3");
});

test("transient refresh failure (5xx) throws a plain error WITHOUT clearing the file", async () => {
  freshCredPath();
  await writeCredentials(sampleCreds({ expires_at: nowSecs() - 10 }));
  const fetchSpy = mockFn(async () => new Response("upstream boom secret-detail", { status: 503 }));
  const err = await getValidAccessToken({ fetch: fetchSpy }).catch((e) => e);
  assert.ok(err instanceof Error);
  assert.ok(!(err instanceof ReconnectRequired));
  assert.ok(!String(err.message).includes("secret-detail"));
  assert.notEqual(await readCredentials(), null);
});

test("no credential file at all → ReconnectRequired", async () => {
  freshCredPath();
  await assert.rejects(getValidAccessToken({ fetch: mockFn() }), ReconnectRequired);
});

test("401/403 on refresh (apikey-class) → StaleSkillError, file KEPT", async () => {
  for (const status of [401, 403]) {
    freshCredPath();
    await writeCredentials(sampleCreds({ expires_at: nowSecs() - 10 }));
    const fetchSpy = mockFn(async () => jsonResponse(status, { message: "Invalid API key" }));
    const err = await getValidAccessToken({ fetch: fetchSpy }).catch((e) => e);
    assert.ok(err instanceof StaleSkillError);
    assert.match(String(err.message), /outdated version/i);
    assert.notEqual(await readCredentials(), null);
  }
});

test("400 validation_failed (malformed-token class) is transient — file KEPT", async () => {
  freshCredPath();
  await writeCredentials(sampleCreds({ expires_at: nowSecs() - 10 }));
  const fetchSpy = mockFn(async () =>
    jsonResponse(400, {
      code: 400,
      error_code: "validation_failed",
      msg: "Refresh token is not valid",
    }),
  );
  const err = await getValidAccessToken({ fetch: fetchSpy }).catch((e) => e);
  assert.ok(err instanceof Error);
  assert.ok(!(err instanceof ReconnectRequired));
  assert.ok(!(err instanceof StaleSkillError));
  assert.notEqual(await readCredentials(), null);
});

test("refresh timeout (AbortSignal expiry) lands in the transient path — file KEPT, lock released", async () => {
  const p = freshCredPath();
  await writeCredentials(sampleCreds({ expires_at: nowSecs() - 10 }));
  const fetchSpy = mockFn(async () => {
    throw new DOMException("The operation timed out.", "TimeoutError");
  });
  const err = await getValidAccessToken({ fetch: fetchSpy }).catch((e) => e);
  assert.ok(err instanceof Error);
  assert.ok(!(err instanceof ReconnectRequired));
  assert.notEqual(await readCredentials(), null);
  await assert.rejects(access(`${p}.lock`)); // released by the finally
  const ok = await getValidAccessToken({ fetch: mockFn(async () => gotrueRefreshOk(5)) });
  assert.equal(ok.accessToken, "unit-test-access-5");
});

test(
  "refresh succeeded but the atomic write fails → fresh token still served with a stderr warning",
  { skip: checkModes ? false : "chmod write-block not enforceable on Windows" },
  async () => {
    const p = freshCredPath();
    const original = sampleCreds({ expires_at: nowSecs() - 10 });
    await writeCredentials(original);
    const realWrite = process.stderr.write.bind(process.stderr);
    let warnings = "";
    process.stderr.write = (chunk) => {
      warnings += String(chunk);
      return true;
    };
    try {
      const got = await getValidAccessToken({
        fetch: mockFn(async () => {
          await chmod(dirname(p), 0o500); // lock already held; only the write fails
          return gotrueRefreshOk(7);
        }),
      });
      assert.equal(got.accessToken, "unit-test-access-7");
      assert.match(warnings, /couldn't save the refreshed credential/i);
      assert.ok(!warnings.includes("unit-test-access"));
      assert.ok(!warnings.includes("unit-test-refresh"));
    } finally {
      process.stderr.write = realWrite;
      await chmod(dirname(p), 0o700);
    }
    assert.equal((await readCredentials())?.access_token, original.access_token);
  },
);

// --- 2b. Lock nonce semantics (stale-break TOCTOU hardening) ----------------

test("the lockfile carries pid:nonce contents while held", async () => {
  const p = freshCredPath();
  await writeCredentials(sampleCreds());
  await withLock(async () => {
    const contents = await readFile(`${p}.lock`, "utf8");
    assert.match(contents, new RegExp(`^${process.pid}:[0-9a-f]{16}$`));
  });
  await assert.rejects(access(`${p}.lock`));
});

test("release after a stale-break does NOT remove the new holder's lock", async () => {
  const p = freshCredPath();
  await writeCredentials(sampleCreds());
  const lockPath = `${p}.lock`;

  let releaseGate;
  const gate = new Promise((r) => (releaseGate = r));
  const holder = withLock(async () => {
    await gate;
  });
  for (let i = 0; i < 100 && !(await access(lockPath).then(() => true, () => false)); i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
  await rm(lockPath, { force: true });
  await writeFile(lockPath, "99999:feedfacefeedface", { mode: 0o600 });

  releaseGate();
  await holder;

  assert.equal(await readFile(lockPath, "utf8"), "99999:feedfacefeedface");
  await rm(lockPath, { force: true });
});

test("two breakers racing one stale lock: both complete, exactly ONE refresh", async () => {
  const p = freshCredPath();
  await writeCredentials(sampleCreds({ expires_at: nowSecs() + 10 })); // < 60s margin
  await writeFile(`${p}.lock`, "424242:deadbeefdeadbeef", { mode: 0o600 });
  const old = new Date(Date.now() - 60_000);
  await utimes(`${p}.lock`, old, old);

  const fetchSpy = mockFn(async () => {
    await new Promise((r) => setTimeout(r, 80));
    return gotrueRefreshOk(2);
  });
  const [a, b] = await Promise.all([
    getValidAccessToken({ fetch: fetchSpy }),
    getValidAccessToken({ fetch: fetchSpy }),
  ]);
  assert.equal(fetchSpy.calls, 1);
  assert.equal(a.accessToken, "unit-test-access-2");
  assert.equal(b.accessToken, "unit-test-access-2");
  await assert.rejects(access(`${p}.lock`));
});
