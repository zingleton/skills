// Pure-function unit tests — no IO, no network, deterministic cross-platform.
// Ports skill-credentials.test.ts §4 (connect classifiers) and adds coverage
// for the other pure helpers the skill relies on.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  classifyOtpSendResponse,
  classifyVerifyResponse,
} from "../scripts/connect.mjs";
import { sniffImageType } from "../scripts/avatar.mjs";
import { mergeById, validateInterestEdits } from "../scripts/interests.mjs";
import { parseJsonArg } from "../scripts/api.mjs";

// --- connect.mjs branch classifiers (codes observed against local GoTrue) ---

test("OTP send: 200 → sent", () => {
  assert.equal(classifyOtpSendResponse(200, null), "sent");
  assert.equal(classifyOtpSendResponse(204, null), "sent");
});

test("OTP send: signups disabled at project level → signups_closed", () => {
  assert.equal(classifyOtpSendResponse(422, "otp_disabled"), "signups_closed");
  assert.equal(classifyOtpSendResponse(400, "user_not_found"), "signups_closed");
});

test("OTP send: rate limit / pending code → code_already_pending", () => {
  assert.equal(
    classifyOtpSendResponse(429, "over_email_send_rate_limit"),
    "code_already_pending",
  );
  assert.equal(classifyOtpSendResponse(429, null), "code_already_pending");
});

test("OTP send: 401/403 (stale embedded key) → stale_key", () => {
  assert.equal(classifyOtpSendResponse(401, null), "stale_key");
  assert.equal(classifyOtpSendResponse(403, "invalid_api_key"), "stale_key");
});

test("OTP send: anything else → error", () => {
  assert.equal(classifyOtpSendResponse(500, null), "error");
  assert.equal(classifyOtpSendResponse(418, "teapot"), "error");
});

test("verify: ok / bad_code / error", () => {
  assert.equal(classifyVerifyResponse(200, null), "ok");
  assert.equal(classifyVerifyResponse(403, "otp_expired"), "bad_code");
  assert.equal(classifyVerifyResponse(401, null), "bad_code");
  assert.equal(classifyVerifyResponse(403, null), "bad_code");
  assert.equal(classifyVerifyResponse(500, null), "error");
});

// --- avatar.mjs magic-byte sniffing ---

test("sniffImageType recognizes PNG, JPEG, WebP by magic bytes", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  const webp = Buffer.from([
    0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  ]);
  assert.equal(sniffImageType(png), "image/png");
  assert.equal(sniffImageType(jpeg), "image/jpeg");
  assert.equal(sniffImageType(webp), "image/webp");
});

test("sniffImageType rejects unsupported or too-short data → null", () => {
  assert.equal(sniffImageType(Buffer.from("GIF89a not allowed")), null);
  assert.equal(sniffImageType(Buffer.from([0x89, 0x50])), null); // truncated PNG
  assert.equal(sniffImageType(Buffer.alloc(0)), null);
  // RIFF container that isn't WEBP (e.g. WAV) must not pass.
  const riffWav = Buffer.from([
    0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
  ]);
  assert.equal(sniffImageType(riffWav), null);
});

// --- interests.mjs read-merge-write helpers ---

test("mergeById replaces matching ids, preserves others, appends new", () => {
  const existing = [
    { task_id: "a", interested: true },
    { task_id: "b", interested: false },
  ];
  const edits = [
    { task_id: "b", interested: true }, // replace
    { task_id: "c", interested: true }, // append
  ];
  assert.deepEqual(mergeById(existing, edits, "task_id"), [
    { task_id: "a", interested: true },
    { task_id: "b", interested: true },
    { task_id: "c", interested: true },
  ]);
});

test("mergeById returns existing untouched when edits is not an array", () => {
  const existing = [{ task_id: "a", interested: true }];
  assert.equal(mergeById(existing, undefined, "task_id"), existing);
});

test("validateInterestEdits accepts valid arrays and undefined (no-op)", () => {
  const usage = "usage-line";
  assert.doesNotThrow(() =>
    validateInterestEdits(undefined, "task_interests", "task_id", usage),
  );
  assert.doesNotThrow(() =>
    validateInterestEdits(
      [{ task_id: "a", interested: true }],
      "task_interests",
      "task_id",
      usage,
    ),
  );
});

test("validateInterestEdits rejects malformed entries", () => {
  const usage = "usage-line";
  assert.throws(
    () => validateInterestEdits("nope", "task_interests", "task_id", usage),
    /must be an array/,
  );
  assert.throws(
    () =>
      validateInterestEdits(
        [{ task_id: "a" }],
        "task_interests",
        "task_id",
        usage,
      ),
    /boolean "interested"/,
  );
  assert.throws(
    () =>
      validateInterestEdits(
        [{ task_id: "", interested: true }],
        "task_interests",
        "task_id",
        usage,
      ),
    /task_id/,
  );
  assert.throws(
    () =>
      validateInterestEdits(
        [{ interested: true }],
        "task_interests",
        "task_id",
        usage,
      ),
    /task_id/,
  );
});

// --- api.mjs CLI argument parsing ---

test("parseJsonArg returns a plain object", () => {
  assert.deepEqual(parseJsonArg('{"a":1,"b":"x"}', "usage"), { a: 1, b: "x" });
});

test("parseJsonArg rejects missing, invalid, or non-object JSON", () => {
  assert.throws(() => parseJsonArg("", "usage-line"), /usage-line/);
  assert.throws(() => parseJsonArg(undefined, "usage-line"), /usage-line/);
  assert.throws(() => parseJsonArg("{bad", "usage-line"), /valid JSON/);
  assert.throws(() => parseJsonArg("[1,2]", "usage-line"), /JSON object/);
  assert.throws(() => parseJsonArg("null", "usage-line"), /JSON object/);
  assert.throws(() => parseJsonArg('"str"', "usage-line"), /JSON object/);
});
