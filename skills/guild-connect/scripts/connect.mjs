#!/usr/bin/env node
// guild-connect: connect.mjs (skill U7, R1/R2; KTD1/KTD4/KTD8).
//
// Links this environment to an AI Power Guild account:
//   1. asks for the member's email,
//   2. requests a SIGN-IN-ONLY emailed code (create_user: false — nothing is
//      ever created from the terminal; unknown emails are sent to the unlisted
//      signup page),
//   3. verifies the code (3 attempts, then a fresh code is required),
//   4. writes the shared credential file and verifies it round-trip with one
//      authenticated API call.
//
// The code is typed at THIS script's own prompt. Concurrent connect runs for
// the same email are unsupported: a new code request supersedes the pending
// one, so always use the NEWEST email.
//
// Hard rules honored here: no token material is ever printed; GoTrue error
// bodies are never echoed (responses are mapped to branch copy via the
// classifiers below — no error_description, no emails, no user ids).

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { pathToFileURL } from "node:url";
import { SUPABASE_URL, ANON_KEY, SIGNUP_URL } from "./config.mjs";
import {
  CREDENTIALS_VERSION,
  ReconnectRequired,
  StaleSkillError,
  clearCredentials,
  credentialsPath,
  readCredentials,
  withLock,
  writeCredentials,
} from "./credentials.mjs";
import { ApiError, getJson } from "./api.mjs";

const MAX_CODE_ATTEMPTS = 3;
const GOTRUE_TIMEOUT_MS = 15_000;

/** A locally classified connect failure whose message is safe to print. */
class ConnectError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConnectError";
  }
}

/**
 * Redaction gate for caught errors: only OUR classified error types carry
 * printable messages. Anything else (runtime errors, library failures) gets
 * the caller's static fallback copy — never a raw err.message.
 */
function safeMessage(err) {
  if (
    err instanceof ApiError ||
    err instanceof ReconnectRequired ||
    err instanceof StaleSkillError ||
    err instanceof ConnectError
  ) {
    return err.message;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Pure branch classifiers (unit-tested; codes observed against GoTrue
// v2.189.0 on the local stack, 2026-06-12).
// ---------------------------------------------------------------------------

/**
 * Classify the response to POST /auth/v1/otp (sign-in-only).
 * → "sent" | "unknown_email" | "code_already_pending" | "stale_key" | "error"
 */
export function classifyOtpSendResponse(status, errorCode) {
  if (status >= 200 && status < 300) return "sent";
  // Sign-in-only refusal for an address with no account. Observed:
  // 422 {"error_code":"otp_disabled","msg":"Signups not allowed for otp"}.
  if (errorCode === "otp_disabled" || errorCode === "user_not_found") {
    return "unknown_email";
  }
  // A code was recently sent / rate limited (max_frequency class). Observed:
  // 429 {"error_code":"over_email_send_rate_limit"}.
  if (status === 429 || errorCode === "over_email_send_rate_limit") {
    return "code_already_pending";
  }
  // 401/403 on the SEND: the embedded public key no longer matches the
  // project (post key-migration) — this skill copy is outdated.
  if (status === 401 || status === 403) return "stale_key";
  return "error";
}

/**
 * Classify the response to POST /auth/v1/verify (type "email").
 * → "ok" | "bad_code" | "error"
 * Observed wrong/expired code: 403 {"error_code":"otp_expired"}.
 */
export function classifyVerifyResponse(status, errorCode) {
  if (status >= 200 && status < 300) return "ok";
  if (errorCode === "otp_expired" || status === 401 || status === 403) return "bad_code";
  return "error";
}

// ---------------------------------------------------------------------------
// GoTrue calls (never echo bodies — only parsed status/error_code feed the
// classifiers; the session payload is written straight to the store)
// ---------------------------------------------------------------------------

async function gotrue(path, payload) {
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}${path}`, {
      method: "POST",
      headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(GOTRUE_TIMEOUT_MS),
    });
  } catch (err) {
    if (err?.name === "TimeoutError" || err?.name === "AbortError") {
      throw new ConnectError(
        "We couldn't reach the auth service. Check your network and try again.",
      );
    }
    throw err;
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    // keep null — callers only use status + error_code
  }
  return { status: res.status, body };
}

function say(line = "") {
  stdout.write(`${line}\n`);
}

async function main() {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    // Already connected? Verify instead of re-prompting (R3: one connect per
    // environment). A dead credential falls through to a fresh connect.
    const existing = await readCredentials();
    if (existing) {
      say(`Already connected as ${existing.email}.`);
      try {
        await getJson("/api/user-profile");
        say("Connection verified — you're all set. No code needed.");
        return 0;
      } catch (err) {
        if (err instanceof ReconnectRequired) {
          say("That connection is no longer valid — let's reconnect.");
          await clearCredentials();
        } else {
          // Only classified errors carry printable copy; anything else gets
          // static fallback (never a raw err.message).
          say(
            `Couldn't verify the connection: ${safeMessage(err) ?? "an unexpected error occurred."}`,
          );
          say("If this keeps happening, check your network and try again.");
          return 1;
        }
      }
    }

    const email = (await rl.question("Email address on your guild account: ")).trim();
    if (!email || !email.includes("@")) {
      say("That doesn't look like an email address. Run connect again.");
      return 1;
    }

    // Sign-in-only: the terminal NEVER creates accounts (R2).
    const send = await gotrue("/auth/v1/otp", { email, create_user: false });
    const branch = classifyOtpSendResponse(send.status, send.body?.error_code ?? null);
    switch (branch) {
      case "sent":
        say(`We emailed a 6-digit code to ${email}.`);
        break;
      case "unknown_email":
        say("No guild account exists for that email address.");
        say(`Create one at ${SIGNUP_URL} — then run connect again.`);
        return 1;
      case "code_already_pending":
        say("A code was recently sent to that address.");
        say("Use the code from the NEWEST email, or wait a minute and run connect again.");
        return 1;
      case "stale_key":
        say("The guild declined this skill's credentials — you may be running an outdated version of this skill.");
        say("Download the latest guild-connect skill and try again.");
        return 1;
      default:
        say("We couldn't send a code right now. Please try again in a few minutes.");
        return 1;
    }

    // Verify: 3 attempts at this script's own prompt, then require a fresh code.
    let session = null;
    for (let attempt = 1; attempt <= MAX_CODE_ATTEMPTS; attempt++) {
      const code = (await rl.question("Enter the 6-digit code from the email: ")).trim();
      const verify = await gotrue("/auth/v1/verify", { email, token: code, type: "email" });
      const v = classifyVerifyResponse(verify.status, verify.body?.error_code ?? null);
      if (v === "ok") {
        session = verify.body;
        break;
      }
      if (v === "bad_code") {
        if (attempt < MAX_CODE_ATTEMPTS) {
          say("That code didn't work. Check the newest email and try again.");
        }
      } else {
        say("Something went wrong verifying the code. Please run connect again.");
        return 1;
      }
    }
    if (!session) {
      say("Three codes didn't match. Run connect again to request a fresh code.");
      return 1;
    }

    const creds = {
      version: CREDENTIALS_VERSION,
      supabase_url: SUPABASE_URL,
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: session.expires_at,
      user_id: session.user?.id ?? "",
      email: session.user?.email ?? email,
    };

    try {
      // Under the sidecar lock (the refresh lock): a sibling command's
      // in-lock refresh can't interleave with this write + read-back.
      await withLock(async () => {
        await writeCredentials(creds);
        // Round-trip 1: the file actually reads back as what we wrote.
        const back = await readCredentials();
        if (!back || back.access_token !== creds.access_token) {
          throw new Error("credential round-trip mismatch");
        }
      });
    } catch {
      // Persistent write failure: surface the escape hatch and make sure the
      // just-created session doesn't orphan (best-effort sign-out).
      say("Could not save the credential file.");
      say(`Tried: ${credentialsPath()}`);
      say(
        "Set AI_POWER_GUILD_CREDENTIALS_PATH to a writable file path and run connect again.",
      );
      await fetch(`${SUPABASE_URL}/auth/v1/logout?scope=local`, {
        method: "POST",
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${session.access_token}` },
      }).catch(() => {});
      return 1;
    }

    // Round-trip 2: one authenticated API call proves the whole chain.
    try {
      await getJson("/api/user-profile");
    } catch (err) {
      say(
        `Saved the credential, but the verification call failed: ${safeMessage(err) ?? "an unexpected error occurred."}`,
      );
      return 1;
    }

    say(`Connected as ${creds.email}. This environment can now act on your guild account.`);
    return 0;
  } finally {
    rl.close();
  }
}

// Only run as a CLI — tests import the pure classifiers above.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      // Same redaction gate as the in-flow catches: classified copy only.
      process.stderr.write(`${safeMessage(err) ?? "Unexpected failure."}\n`);
      process.exit(1);
    },
  );
}
