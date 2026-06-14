// guild-connect API client (skill U7, R6) — every data call goes through the
// app's /api routes with a Bearer token from the shared credential store.
//
// 401 discipline (KTD4, AE4 script half): the server is authoritative over
// the local clock. On a 401 we force ONE refresh (passing the rejected token
// so a sibling's rotation is reused instead) and retry ONCE; a second 401
// means the session is revoked → clear the credential and throw
// ReconnectRequired. No retry loops.
//
// REDACTION (hard rule): thrown errors carry only the parsed `{error}` /
// `{reason}` fields our API intentionally returns — never the Authorization
// header, never a raw response body, never GoTrue error detail. Nothing in
// this module writes to the console.

import { SITE_URL } from "./config.mjs";
import {
  ReconnectRequired,
  clearCredentials,
  getValidAccessToken,
} from "./credentials.mjs";

export { ReconnectRequired };

/**
 * A non-2xx API response, reduced to safe fields: `status`, the server's
 * friendly `{error}` copy as `message` (or a generic fallback — raw bodies
 * are never echoed), and the machine-readable `{reason}` when present.
 */
export class ApiError extends Error {
  constructor(status, message, reason) {
    super(message || `Request failed (HTTP ${status}).`);
    this.name = "ApiError";
    this.status = status;
    this.reason = reason ?? null;
  }
}

const REVOKED_MSG =
  "Your connection was revoked or has expired. Run connect again to relink your account.";

/** Per-request network bound; each attempt (including the 401 retry) gets its own signal. */
const REQUEST_TIMEOUT_MS = 30_000;

// actingAs()'s locked credential read, handed one-shot to the NEXT apiRequest
// so a command's banner and its first API call share a single
// credential-file read (every command is its own process — see runCommand).
let bannerToken = null;

async function safeErrorFields(response) {
  // Parse JSON if possible and keep ONLY the contract fields. A non-JSON or
  // off-contract body yields nulls → generic message.
  try {
    const body = await response.json();
    return {
      error: typeof body?.error === "string" ? body.error : null,
      reason: typeof body?.reason === "string" ? body.reason : null,
    };
  } catch {
    return { error: null, reason: null };
  }
}

/**
 * Authenticated request against the app API. `path` starts with `/api/`.
 * Options: method, json (object body), bytes (+ contentType), fetch
 * (injection for tests). Resolves the parsed JSON body on 2xx; throws
 * ApiError / ReconnectRequired otherwise.
 */
export async function apiRequest(path, opts = {}) {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const method = opts.method ?? "GET";

  const doFetch = async (accessToken) => {
    const headers = { Authorization: `Bearer ${accessToken}` };
    let body;
    if (opts.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.json);
    } else if (opts.bytes !== undefined) {
      headers["Content-Type"] = opts.contentType;
      body = opts.bytes;
    }
    // A FRESH signal per attempt — the 401 retry must not inherit an
    // already-ticking (or already-aborted) timer from the first attempt.
    const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    try {
      return await fetchImpl(`${SITE_URL}${path}`, { method, headers, body, signal });
    } catch (err) {
      if (signal.aborted || err?.name === "TimeoutError" || err?.name === "AbortError") {
        throw new ApiError(0, "Request timed out. Try again.");
      }
      throw err;
    }
  };

  // Reuse the banner's locked read when actingAs() just did one (one-shot);
  // otherwise read the store as before.
  const cached = bannerToken;
  bannerToken = null;
  const first = cached ?? (await getValidAccessToken({ fetch: fetchImpl }));
  let response = await doFetch(first.accessToken);

  if (response.status === 401) {
    // One forced refresh, then one retry. staleToken makes the store refresh
    // even when the local clock says the token is fresh — and reuse a
    // sibling's rotation when one already happened.
    const second = await getValidAccessToken({
      fetch: fetchImpl,
      staleToken: first.accessToken,
    });
    response = await doFetch(second.accessToken);
    if (response.status === 401) {
      await clearCredentials();
      throw new ReconnectRequired(REVOKED_MSG);
    }
  }

  if (!response.ok) {
    const { error, reason } = await safeErrorFields(response);
    throw new ApiError(response.status, error, reason);
  }
  return response.json();
}

/**
 * Parse a CLI JSON argument: required, valid JSON, and a plain object (not
 * an array). Every failure message ends with the caller's usage line.
 */
export function parseJsonArg(raw, usage) {
  if (!raw) throw new Error(usage);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Argument must be valid JSON. ${usage}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Argument must be a JSON object. ${usage}`);
  }
  return parsed;
}

/** GET an API path, parsed JSON out. */
export function getJson(path, opts = {}) {
  return apiRequest(path, { ...opts, method: "GET" });
}

/** POST a JSON payload to an API path, parsed JSON out. */
export function postJson(path, json, opts = {}) {
  return apiRequest(path, { ...opts, method: "POST", json });
}

/** POST raw bytes (avatar upload) with an explicit Content-Type. */
export function postBytes(path, bytes, contentType, opts = {}) {
  return apiRequest(path, { ...opts, method: "POST", bytes, contentType });
}

/**
 * Print the mandatory "Acting as <email>" banner to STDERR (stdout stays
 * machine-readable JSON) and return the stored identity, derived from the
 * store's locked read (getValidAccessToken) — the read is then reused by the
 * command's first apiRequest, so the banner costs no extra credential-file
 * read. Throws ReconnectRequired when no credential exists. Every command
 * calls this before doing anything else (SKILL.md hard rule).
 */
export async function actingAs() {
  const token = await getValidAccessToken();
  bannerToken = token;
  process.stderr.write(`Acting as ${token.email}\n`);
  return { email: token.email, userId: token.userId };
}

/**
 * Shared CLI wrapper: run `fn`, print its JSON result to stdout; on failure
 * print the SAFE message to stderr (machine-readable JSON to stdout when the
 * error carries a `reason`) and exit non-zero. Never prints token material —
 * the error types above guarantee their messages are body-free.
 */
/** Write to a stream and resolve once the write has been flushed/accepted. */
function writeFlushed(stream, text) {
  return new Promise((resolve) => stream.write(text, () => resolve()));
}

export async function runCommand(fn) {
  try {
    const result = await fn();
    if (result !== undefined) {
      // Flush THROUGH the write callback before exiting — process.exit(0)
      // immediately after a fire-and-forget write can truncate a still-
      // draining stdout pipe (large catalogs, slow consumers).
      await writeFlushed(process.stdout, `${JSON.stringify(result, null, 2)}\n`);
    }
    process.exit(0);
  } catch (err) {
    if (err instanceof ApiError) {
      const out = { ok: false, error: err.message };
      if (err.reason) out.reason = err.reason;
      if (err.reason === "already_has_submission") {
        out.hint =
          "A submission already exists — switch to edit mode: use interests.mjs get/set instead of intake.mjs create. " +
          "Your submission may already be saved — run interests.mjs get to check before retrying create.";
      }
      if (err.reason === "catalog_changed") {
        out.hint =
          "The catalog changed mid-interview — re-fetch options with intake.mjs options --fresh (cache-busting), re-confirm changed items, then retry.";
      }
      await writeFlushed(process.stdout, `${JSON.stringify(out, null, 2)}\n`);
      await writeFlushed(process.stderr, `${err.message}\n`);
    } else if (err instanceof ReconnectRequired) {
      await writeFlushed(process.stderr, `${err.message}\n`);
    } else {
      // Unknown failure: print its message only (our own modules never put
      // bodies or tokens in messages).
      await writeFlushed(process.stderr, `${err?.message ?? "Unexpected failure."}\n`);
    }
    process.exit(1);
  }
}
