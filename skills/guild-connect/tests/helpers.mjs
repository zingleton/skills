// Shared fixtures for the guild-connect unit tests. NOT a test file (no
// `.test.` in the name) so `node --test` skips it. Ported from the app repo's
// tests/skill-credentials.test.ts so this skill self-verifies standalone.

export const nowSecs = () => Math.floor(Date.now() / 1000);

/** A sample credential record; override any field via `over`. */
export function sampleCreds(over = {}) {
  return {
    version: 1,
    supabase_url: "http://127.0.0.1:54321",
    access_token: "unit-test-access-1",
    refresh_token: "unit-test-refresh-1",
    expires_at: nowSecs() + 3600,
    user_id: "00000000-0000-0000-0000-000000000001",
    email: "store-test@example.com",
    ...over,
  };
}

export function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A successful GoTrue refresh response rotating to access/refresh `-${n}`. */
export function gotrueRefreshOk(n) {
  return jsonResponse(200, {
    access_token: `unit-test-access-${n}`,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: nowSecs() + 3600,
    refresh_token: `unit-test-refresh-${n}`,
    user: { id: "00000000-0000-0000-0000-000000000001", email: "store-test@example.com" },
  });
}

/** Minimal vi.fn() stand-in: tracks `.calls`, forwards to `impl`. */
export function mockFn(impl) {
  const f = (...args) => {
    f.calls++;
    return impl?.(...args);
  };
  f.calls = 0;
  return f;
}

// Unix permission bits (0600/0700) and chmod-based write-failure simulation
// only mean anything off Windows; gate those assertions on this.
export const checkModes = process.platform !== "win32";
