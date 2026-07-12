// guild-content script tests (content-manage U6; R10/R12). Offline — every
// network seam is injected; the --confirm gates are exercised as real child
// processes (they must refuse BEFORE credentials or network are touched, so
// no fixture is needed).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

import { ApiError } from "../../guild-connect/scripts/api.mjs";
import { parseArgs as listArgs, listContent } from "../scripts/list.mjs";
import { parseArgs as getArgs, getContent } from "../scripts/get.mjs";
import {
  parseArgs as postArgs,
  validatePayload,
  postContent,
} from "../scripts/post.mjs";
import { validatePatch, editContent } from "../scripts/edit.mjs";
import { parseArgs as retractArgs, retractContent } from "../scripts/retract.mjs";

const run = promisify(execFile);
const scriptsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts");

const PAYLOAD = {
  title: "Post title",
  body: "Review body",
  link: "https://example.com/x",
  kind: "story",
  tags: [{ role_key: "engineer" }],
};

// --- flag parsing --------------------------------------------------------------

test("list.mjs flags map to query params and reject bad status", () => {
  assert.deepEqual(listArgs(["--mine", "--status=retracted", "--limit=5"]), {
    mine: "true",
    status: "retracted",
    limit: "5",
  });
  assert.throws(() => listArgs(["--status=candidate"]), /published or retracted/);
  assert.throws(() => listArgs(["--bogus"]), /Unknown argument/);
});

test("get.mjs and retract.mjs require --id", () => {
  assert.deepEqual(getArgs(["--id=abc"]), { id: "abc" });
  assert.throws(() => getArgs([]), /--id is required/);
  assert.deepEqual(retractArgs(["--id=abc", "--confirm"]), {
    id: "abc",
    confirm: true,
  });
  assert.throws(() => retractArgs(["--confirm"]), /--id is required/);
});

// --- post: documented body, no blind retry --------------------------------------

test("postContent sends the documented body to the manage route and returns the item", async () => {
  const calls = [];
  const fake = async (path, json) => {
    calls.push({ path, json });
    return { ok: true, item: { id: "new-id", updatedAt: "t1" } };
  };
  const item = await postContent(PAYLOAD, { postJson: fake });
  assert.deepEqual(item, { id: "new-id", updatedAt: "t1" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/api/content/manage");
  assert.deepEqual(calls[0].json, PAYLOAD);
});

test("a duplicate-title 409 surfaces the existing id and is NEVER retried", async () => {
  let calls = 0;
  const fake = async () => {
    calls += 1;
    throw new ApiError(
      409,
      "You published an item with this title moments ago.",
      "duplicate_title",
      { id: "existing-id" },
    );
  };
  await assert.rejects(
    () => postContent(PAYLOAD, { postJson: fake }),
    (err) => {
      assert.equal(err.status, 409);
      assert.equal(err.reason, "duplicate_title");
      assert.deepEqual(err.existing, { id: "existing-id" });
      // Redaction: the message is the server's friendly copy, nothing else.
      assert.ok(!/bearer|authorization/i.test(err.message));
      return true;
    },
  );
  assert.equal(calls, 1);
});

test("validatePayload rejects a missing title/body/tags before any network call", () => {
  assert.throws(() => validatePayload({ ...PAYLOAD, title: " " }), /"title"/);
  assert.throws(() => validatePayload({ ...PAYLOAD, body: "" }), /"body"/);
  assert.throws(() => validatePayload({ ...PAYLOAD, tags: [] }), /at least one tag/);
  assert.deepEqual(validatePayload(PAYLOAD), PAYLOAD);
});

// --- edit: the read step is mandatory --------------------------------------------

test("edit.mjs refuses a patch without updatedAt (forces read-merge-write)", () => {
  assert.throws(() => validatePatch({ title: "x" }), /updatedAt/);
  assert.throws(() => validatePatch({ updatedAt: "t1" }), /no fields/);
  const patch = { title: "x", updatedAt: "t1" };
  assert.deepEqual(validatePatch(patch), patch);
});

test("editContent PATCHes the item route with the patch as-is", async () => {
  const calls = [];
  const fake = async (path, opts) => {
    calls.push({ path, opts });
    return { ok: true, item: { id: "abc", updatedAt: "t2" } };
  };
  const item = await editContent("abc", { title: "x", updatedAt: "t1" }, { apiRequest: fake });
  assert.deepEqual(item, { id: "abc", updatedAt: "t2" });
  assert.equal(calls[0].path, "/api/content/manage/abc");
  assert.equal(calls[0].opts.method, "PATCH");
  assert.deepEqual(calls[0].opts.json, { title: "x", updatedAt: "t1" });
});

test("a stale-precondition 409 propagates its reason for the reload-and-retry copy", async () => {
  const fake = async () => {
    throw new ApiError(409, "This item changed since you loaded it. Reload and retry.", "stale_precondition");
  };
  await assert.rejects(
    () => editContent("abc", { title: "x", updatedAt: "old" }, { apiRequest: fake }),
    (err) => err.reason === "stale_precondition",
  );
});

// --- retract: snapshot echo --------------------------------------------------------

test("retractContent DELETEs and returns the snapshot", async () => {
  const calls = [];
  const fake = async (path, opts) => {
    calls.push({ path, opts });
    return {
      ok: true,
      item: { id: "abc", title: "T", publishedAt: "p1", status: "retracted" },
    };
  };
  const item = await retractContent("abc", { apiRequest: fake });
  assert.deepEqual(item, {
    id: "abc",
    title: "T",
    publishedAt: "p1",
    status: "retracted",
  });
  assert.equal(calls[0].opts.method, "DELETE");
});

// --- list/get read seams --------------------------------------------------------------

test("listContent builds the query string; getContent hits the item route", async () => {
  const paths = [];
  const fake = async (path) => {
    paths.push(path);
    return { ok: true, items: [{ id: "1" }], item: { id: "1" } };
  };
  await listContent({ status: "published", mine: "true", limit: "5" }, { getJson: fake });
  await listContent({}, { getJson: fake });
  await getContent("abc", { getJson: fake });
  assert.equal(paths[0], "/api/content/manage?status=published&mine=true&limit=5");
  assert.equal(paths[1], "/api/content/manage");
  assert.equal(paths[2], "/api/content/manage/abc");
});

// --- the --confirm gates refuse in a real process, before credentials/network ------

async function expectRefusal(script, args, pattern) {
  try {
    await run(process.execPath, [join(scriptsDir, script), ...args], {
      timeout: 15_000,
      // No credential file exists at this path — proves the refusal fires
      // before credentials are even read.
      env: { ...process.env, AI_POWER_GUILD_CREDENTIALS_PATH: join(scriptsDir, "no-such-cred.json") },
    });
    assert.fail(`${script} should have exited non-zero`);
  } catch (err) {
    assert.equal(err.code, 1);
    assert.match(String(err.stderr), pattern);
    assert.ok(!/bearer|authorization/i.test(String(err.stderr)));
  }
}

test("post.mjs without --confirm refuses before any network call", async () => {
  await expectRefusal("post.mjs", [JSON.stringify(PAYLOAD)], /Refusing to post without --confirm/);
});

test("retract.mjs without --confirm refuses before any network call", async () => {
  await expectRefusal("retract.mjs", ["--id=abc"], /Refusing to retract without --confirm/);
});
