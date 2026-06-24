// guild-connect credential store (skill U7, KTD4) — THE PUBLISHED CONTRACT.
//
// Every guild skill in an environment shares one credential file:
//   $AI_POWER_GUILD_CREDENTIALS_PATH            (locked-down-harness override —
//                                                the env var holds only a PATH,
//                                                never token material)
//   $XDG_CONFIG_HOME/ai-power-guild/credentials.json
//   ~/.config/ai-power-guild/credentials.json
//
// Shape: { version: 1, supabase_url, access_token, refresh_token, expires_at,
//          user_id, email }  — file 0600, directory 0700.
//
// Supabase refresh tokens are single-use (with a short reuse interval); a
// concurrent stale refresh can kill the whole session family. So refresh
// follows the MSAL cross-process pattern:
//   sidecar lock (credentials.json.lock, O_CREAT|O_EXCL, 100ms retry,
//   10s timeout, break locks older than 30s)
//   → RE-READ after lock (a sibling may already have rotated)
//   → refresh via GoTrue REST → atomic write (tmp + rename, 0600) → unlock.
// On invalid_grant: re-read once more (sibling may have won between our read
// and GoTrue's answer), else clear the file and throw ReconnectRequired.
// The lock serializes refresh within one machine only — by design (KTD4).
//
// Prohibitions (published contract): never log token material; never export
// tokens as environment variables. Error messages here carry NO server body
// text and NO token fragments.

import { mkdir, readFile, writeFile, rename, unlink, stat, open, chmod } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { ANON_KEY } from "./config.mjs";

export const CREDENTIALS_VERSION = 1;

/** Refresh proactively when fewer than this many seconds remain (KTD4). */
const FRESH_MARGIN_SECS = 60;

const LOCK_RETRY_MS = 100;
const LOCK_TIMEOUT_MS = 10_000;
const LOCK_STALE_MS = 30_000;
// Refresh network bound — deliberately under the 10s lock timeout so a hung
// refresh can never hold the sidecar lock longer than other waiters wait.
const REFRESH_TIMEOUT_MS = 8_000;

/**
 * The connection is gone (revoked, expired beyond refresh, or never made).
 * Callers print `error.message` and stop — they never retry-loop.
 */
export class ReconnectRequired extends Error {
  constructor(message) {
    super(message ?? "Not connected. Run the connect script to link your account.");
    this.name = "ReconnectRequired";
    this.code = "RECONNECT_REQUIRED";
  }
}

/**
 * The auth service rejected this skill's EMBEDDED public key (401/403 on the
 * refresh endpoint — apikey-class, e.g. after a project key migration). The
 * stored credential may still be perfectly valid, so the file is KEPT; the
 * fix is a newer skill copy, never a reconnect loop.
 */
export class StaleSkillError extends Error {
  constructor(message) {
    super(
      message ??
        "You may be running an outdated version of this skill. " +
          "Download the latest guild-connect skill and try again.",
    );
    this.name = "StaleSkillError";
    this.code = "STALE_SKILL";
  }
}

/** Resolve the credential file path. Reads the environment at call time. */
export function credentialsPath() {
  const override = process.env.AI_POWER_GUILD_CREDENTIALS_PATH;
  if (override) return override;
  const configHome =
    process.env.XDG_CONFIG_HOME && process.env.XDG_CONFIG_HOME.trim() !== ""
      ? process.env.XDG_CONFIG_HOME
      : join(homedir(), ".config");
  return join(configHome, "ai-power-guild", "credentials.json");
}

/**
 * Read the credential file. Missing, unreadable, or unparsable → null (the
 * "not connected" state); never throws, never logs file contents.
 */
export async function readCredentials() {
  try {
    const raw = await readFile(credentialsPath(), "utf8");
    const parsed = JSON.parse(raw);
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      typeof parsed.access_token !== "string" ||
      typeof parsed.refresh_token !== "string" ||
      typeof parsed.expires_at !== "number"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Atomic write: tmp file (0600) in the same directory, then rename over the
 * target. The directory is created 0700. A failed write leaves any existing
 * file untouched and removes its tmp litter.
 */
export async function writeCredentials(creds) {
  const target = credentialsPath();
  const dir = dirname(target);
  // 0700 applies when this call creates the directory (umask can only clear
  // bits 0700 doesn't carry); an existing directory's mode is respected.
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const tmp = join(dir, `.credentials-${randomBytes(6).toString("hex")}.tmp`);
  try {
    await writeFile(tmp, `${JSON.stringify(creds, null, 2)}\n`, { mode: 0o600 });
    await rename(tmp, target);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
  await chmod(target, 0o600).catch(() => {});
}

/** Remove the credential file (best-effort; missing file is fine). */
export async function clearCredentials() {
  await unlink(credentialsPath()).catch(() => {});
}

// ---------------------------------------------------------------------------
// Sidecar lock
// ---------------------------------------------------------------------------

async function acquireLock(lockPath, { lockRetryMs, lockTimeoutMs, lockStaleMs }) {
  const deadline = Date.now() + lockTimeoutMs;
  const lockBusyError = () =>
    new Error(
      "Another guild process is holding the credentials lock. " +
        "Wait a moment and try again (a stale lock clears itself after 30 seconds).",
    );
  // pid:nonce contents — release and stale-break verify the contents before
  // unlinking, so neither path can ever remove a lock it didn't observe
  // (kills the stat→unlink TOCTOU against a new holder).
  const token = `${process.pid}:${randomBytes(8).toString("hex")}`;
  await mkdir(dirname(lockPath), { recursive: true, mode: 0o700 });
  for (;;) {
    try {
      // O_CREAT|O_EXCL — fails if the lock exists. Atomic on local
      // filesystems; networked/virtual home dirs are a documented soft spot.
      const handle = await open(lockPath, "wx", 0o600);
      try {
        await handle.writeFile(token);
      } finally {
        await handle.close();
      }
      return token;
    } catch (err) {
      // EEXIST is normal contention. On Windows, a lock caught mid rename/unlink
      // by another racer surfaces as EPERM/EACCES instead — also transient
      // contention, not a real failure; back off and retry (the deadline below
      // bounds it). Anything else is a genuine error.
      const code = err?.code;
      if (code !== "EEXIST" && code !== "EPERM" && code !== "EACCES") throw err;
      // Break locks left by crashed processes. A plain stat→unlink (even with a
      // re-read) is racy: two breakers can both observe the same stale file and
      // both unlink, with the second unlink deleting whatever a winner just
      // re-created — so both "acquire" and both refresh. Instead break it
      // ATOMICALLY: rename the stale lock aside to a per-breaker name. rename
      // moves an inode atomically, so for one lockPath exactly ONE breaker wins
      // and every loser sees ENOENT and simply retries the open. We then verify
      // the file we captured is the stale one we saw; if a holder slipped in and
      // we captured a FRESH lock, we put it back untouched rather than delete it.
      let observed, s;
      try {
        observed = await readFile(lockPath, "utf8");
        s = await stat(lockPath);
      } catch (e2) {
        if (e2?.code === "ENOENT") continue; // vanished — the next open will win
        // A transient inspection error (e.g. Windows EPERM mid-transition).
        if (Date.now() > deadline) throw lockBusyError();
        await new Promise((r) => setTimeout(r, lockRetryMs));
        continue;
      }
      if (Date.now() - s.mtimeMs > lockStaleMs) {
        // The token carries a ":" (pid:nonce) which is illegal in a Windows
        // filename, so derive a filesystem-safe, per-breaker aside name.
        const aside = `${lockPath}.stale-${token.replace(":", "-")}`;
        try {
          await rename(lockPath, aside);
        } catch {
          // Another breaker already moved/removed it, or the rename failed
          // transiently. Back off and retry — but honor the deadline so a
          // persistently-failing rename can never spin the loop forever.
          if (Date.now() > deadline) throw lockBusyError();
          await new Promise((r) => setTimeout(r, lockRetryMs));
          continue;
        }
        const moved = await readFile(aside, "utf8").catch(() => null);
        const ms = await stat(aside).catch(() => null);
        if (moved === observed && ms && Date.now() - ms.mtimeMs > lockStaleMs) {
          await unlink(aside).catch(() => {}); // confirmed stale — drop it
        } else {
          // A live/newer holder slipped in between our inspection and rename;
          // restore its lock so it keeps its hold (fall back to dropping our
          // stolen copy if the path was meanwhile retaken).
          await rename(aside, lockPath).catch(() => unlink(aside).catch(() => {}));
        }
        continue;
      }
      if (Date.now() > deadline) throw lockBusyError();
      await new Promise((r) => setTimeout(r, lockRetryMs));
    }
  }
}

async function releaseLock(lockPath, token) {
  // Read-verify-unlink: remove the lock only while it still holds OUR token.
  // After a sibling broke this lock as stale, the path may hold the NEW
  // holder's lock — releasing blindly would unlock someone else's hold.
  try {
    const contents = await readFile(lockPath, "utf8");
    if (contents !== token) return;
    await unlink(lockPath);
  } catch {
    // ENOENT (already broken/released) or unreadable — nothing safe to remove.
  }
}

/**
 * Run `fn` while holding the credential sidecar lock — the SAME lock the
 * refresh path uses. connect.mjs wraps its credential write + round-trip
 * verify in this so a sibling's in-lock refresh can't clobber (or be
 * clobbered by) a fresh connect. Lock tuning options as getValidAccessToken.
 */
export async function withLock(fn, opts = {}) {
  const lockOpts = {
    lockRetryMs: opts.lockRetryMs ?? LOCK_RETRY_MS,
    lockTimeoutMs: opts.lockTimeoutMs ?? LOCK_TIMEOUT_MS,
    lockStaleMs: opts.lockStaleMs ?? LOCK_STALE_MS,
  };
  const lockPath = `${credentialsPath()}.lock`;
  const token = await acquireLock(lockPath, lockOpts);
  try {
    return await fn();
  } finally {
    await releaseLock(lockPath, token);
  }
}

// ---------------------------------------------------------------------------
// Refresh
// ---------------------------------------------------------------------------

const TRANSIENT_MSG =
  "Couldn't refresh the connection right now. Check your network and try again in a moment.";
const RECONNECT_MSG =
  "Your connection is no longer valid (it may have been disconnected). Run connect again.";

function pickToken(creds) {
  return {
    accessToken: creds.access_token,
    email: creds.email,
    userId: creds.user_id,
    supabaseUrl: creds.supabase_url,
  };
}

/**
 * Return a valid access token, refreshing (under the lock) when fewer than
 * 60 seconds remain — or unconditionally when `staleToken` matches the stored
 * token (the caller's server said 401: authoritative over the local clock).
 *
 * Options (all optional; tests + api.mjs use them):
 *   fetch          — injected fetch (defaults to global fetch)
 *   now            — () => unix seconds (defaults to the clock)
 *   staleToken     — an access token the API just rejected with 401
 *   lockRetryMs / lockTimeoutMs / lockStaleMs — lock tuning (tests)
 *
 * Resolves { accessToken, email, userId, supabaseUrl }.
 * Throws ReconnectRequired when the stored session is unrecoverable (file is
 * cleared first), or a plain Error for transient failures (file kept).
 */
export async function getValidAccessToken(opts = {}) {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const now = opts.now ?? (() => Math.floor(Date.now() / 1000));

  return withLock(async () => {
    // Re-read under the lock — a sibling may have refreshed while we waited.
    const creds = await readCredentials();
    if (!creds) throw new ReconnectRequired();

    const fresh = creds.expires_at - now() > FRESH_MARGIN_SECS;
    const rotatedSinceCaller = opts.staleToken
      ? creds.access_token !== opts.staleToken
      : false;
    if (fresh && (!opts.staleToken || rotatedSinceCaller)) return pickToken(creds);

    // Refresh via GoTrue REST. Single-use rotation: the response carries a
    // NEW refresh token that must hit disk before anyone else refreshes.
    let res;
    try {
      res = await fetchImpl(
        `${creds.supabase_url}/auth/v1/token?grant_type=refresh_token`,
        {
          method: "POST",
          headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: creds.refresh_token }),
          // Bounded under the 10s lock timeout; an abort rejects the fetch
          // and lands in the transient path below, lock released by withLock.
          signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
        },
      );
    } catch {
      // Network failure or timeout — no body to leak, file kept.
      throw new Error(TRANSIENT_MSG);
    }

    if (res.ok) {
      const body = await res.json().catch(() => null);
      if (!body || typeof body.access_token !== "string") {
        throw new Error(TRANSIENT_MSG);
      }
      const next = {
        ...creds,
        version: CREDENTIALS_VERSION,
        access_token: body.access_token,
        refresh_token: body.refresh_token ?? creds.refresh_token,
        expires_at:
          typeof body.expires_at === "number"
            ? body.expires_at
            : now() + (typeof body.expires_in === "number" ? body.expires_in : 3600),
        user_id: body.user?.id ?? creds.user_id,
        email: body.user?.email ?? creds.email,
      };
      try {
        await writeCredentials(next);
      } catch {
        // The refresh itself SUCCEEDED — failing the caller now would waste a
        // single-use rotation. Serve THIS invocation the fresh token and warn
        // loudly: the rotation never hit disk, so the next run may find a
        // dead stored refresh token and need a reconnect.
        process.stderr.write(
          "Warning: couldn't save the refreshed credential — the next run may need to reconnect.\n",
        );
      }
      return pickToken(next);
    }

    // 429 / 5xx — transient; keep the file, let the caller try again later.
    if (res.status === 429 || res.status >= 500) throw new Error(TRANSIENT_MSG);

    // 401/403 — apikey-class rejection (e.g. the embedded public key no
    // longer matches the project after a key migration). The stored session
    // may still be valid, so the file is KEPT: outdated skill, not reconnect.
    if (res.status === 401 || res.status === 403) throw new StaleSkillError();

    // True grant death ONLY: HTTP 400 with an invalid_grant-class code.
    // Observed empirically (local GoTrue, 2026-06-12): a revoked/rotated-out
    // refresh token returns 400 {"error_code":"refresh_token_not_found"};
    // OAuth-shape servers put "invalid_grant" in `error`. (A malformed token
    // string returns 400 validation_failed — NOT grant death; it stays
    // transient below so an unclassified failure never burns the file.)
    const body = await res.json().catch(() => null);
    const codes = `${body?.error_code ?? ""} ${body?.error ?? ""}`;
    if (res.status === 400 && /invalid_grant|refresh_token_not_found/.test(codes)) {
      // Re-read ONCE — a sibling outside our lock (rare cross-copy case)
      // may have won.
      const again = await readCredentials();
      if (
        again &&
        again.refresh_token !== creds.refresh_token &&
        again.expires_at - now() > FRESH_MARGIN_SECS
      ) {
        return pickToken(again);
      }
      await clearCredentials();
      throw new ReconnectRequired(RECONNECT_MSG);
    }

    // Anything else (e.g. 400 validation_failed, 404) — transient.
    throw new Error(TRANSIENT_MSG);
  }, opts);
}
