// guild-catalog script tests (content-manage U7; R11/R12). Offline — network
// seams injected; the remove --confirm gate runs as a real child process (it
// must refuse before credentials or network are touched).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

import { ApiError } from "../../guild-connect/scripts/api.mjs";
import { listCatalog } from "../scripts/list.mjs";
import { isCommitSha, validatePayload, addCatalogEntry } from "../scripts/add.mjs";
import { parseArgs as editArgs, validatePatch, editCatalogEntry } from "../scripts/edit.mjs";
import { parseArgs as repinArgs, repinPatch } from "../scripts/repin.mjs";
import { parseArgs as removeArgs, removeCatalogEntry } from "../scripts/remove.mjs";

const run = promisify(execFile);
const scriptsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts");

const PAYLOAD = {
  slug: "example-skill",
  name: "Example Skill",
  sourceRepo: "zingleton/skills",
  sourcePath: "skills/example-skill",
  pinnedCommit: "abc1234def5678",
  strength: 0,
  roleKeys: ["engineer"],
};

// --- pin discipline -----------------------------------------------------------

test("a non-SHA pin (branch name) is rejected locally, before any network call", () => {
  assert.equal(isCommitSha("abc1234"), true);
  assert.equal(isCommitSha("main"), false);
  assert.equal(isCommitSha("HEAD"), false);
  assert.equal(isCommitSha("ABC1234"), false); // git SHAs are lowercase hex
  assert.equal(isCommitSha(""), false);
  assert.throws(
    () => validatePayload({ ...PAYLOAD, pinnedCommit: "main" }),
    /commit SHA.*never a branch/,
  );
  assert.throws(() => validatePayload({ ...PAYLOAD, slug: "" }), /"slug"/);
  assert.deepEqual(validatePayload(PAYLOAD), PAYLOAD);
});

test("addCatalogEntry maps the payload to the documented camelCase body", async () => {
  const calls = [];
  const fake = async (path, json) => {
    calls.push({ path, json });
    return { ok: true, id: "id-1", slug: PAYLOAD.slug, updatedAt: "t1" };
  };
  const body = await addCatalogEntry(PAYLOAD, { postJson: fake });
  assert.equal(body.id, "id-1");
  assert.equal(calls[0].path, "/api/skills-catalog/manage");
  assert.deepEqual(calls[0].json, PAYLOAD);
});

test("a duplicate-source 409 surfaces the existing entry's identity, no retry", async () => {
  let calls = 0;
  const fake = async () => {
    calls += 1;
    throw new ApiError(
      409,
      "That source repo and path is already catalogued.",
      null,
      { id: "existing-id", slug: "existing-slug" },
    );
  };
  await assert.rejects(
    () => addCatalogEntry(PAYLOAD, { postJson: fake }),
    (err) => {
      assert.deepEqual(err.existing, { id: "existing-id", slug: "existing-slug" });
      assert.ok(!/bearer|authorization/i.test(err.message));
      return true;
    },
  );
  assert.equal(calls, 1);
});

// --- edit: read-merge-write, immutable slug -------------------------------------

test("edit.mjs requires --id and refuses a patch without updatedAt or with a slug", () => {
  assert.deepEqual(editArgs(["--id=abc", "{}"]), { id: "abc", raw: "{}" });
  assert.throws(() => editArgs(["{}", "extra"]), /Unexpected argument/);
  assert.throws(() => validatePatch({ strength: 2 }), /updatedAt/);
  assert.throws(() => validatePatch({ updatedAt: "t1" }), /no fields/);
  assert.throws(() => validatePatch({ slug: "x", updatedAt: "t1" }), /immutable/);
  assert.throws(
    () => validatePatch({ pinnedCommit: "main", updatedAt: "t1" }),
    /commit SHA/,
  );
  const good = { strength: 2, updatedAt: "t1" };
  assert.deepEqual(validatePatch(good), good);
});

test("editCatalogEntry PATCHes the entry route; a stale 409 propagates its reason", async () => {
  const calls = [];
  const fake = async (path, opts) => {
    calls.push({ path, opts });
    return { ok: true, id: "abc", slug: "s", updatedAt: "t2" };
  };
  await editCatalogEntry("abc", { strength: 3, updatedAt: "t1" }, { apiRequest: fake });
  assert.equal(calls[0].path, "/api/skills-catalog/manage/abc");
  assert.equal(calls[0].opts.method, "PATCH");
  assert.deepEqual(calls[0].opts.json, { strength: 3, updatedAt: "t1" });

  const stale = async () => {
    throw new ApiError(409, "This entry changed since you loaded it. Reload and retry.");
  };
  await assert.rejects(
    () => editCatalogEntry("abc", { strength: 3, updatedAt: "old" }, { apiRequest: stale }),
    /Reload and retry/,
  );
});

// --- repin: pin + precondition only ----------------------------------------------

test("repin sends ONLY pinnedCommit and updatedAt (targeting untouched)", () => {
  assert.deepEqual(repinPatch("abc1234", "t1"), {
    pinnedCommit: "abc1234",
    updatedAt: "t1",
  });
  assert.deepEqual(
    repinArgs(["--id=abc", "--commit=abc1234", "--updated-at=t1"]),
    { id: "abc", commit: "abc1234", updatedAt: "t1" },
  );
  assert.throws(() => repinArgs(["--id=abc", "--commit=main", "--updated-at=t1"]), /commit SHA/);
  assert.throws(() => repinArgs(["--id=abc", "--commit=abc1234"]), /--updated-at is required/);
});

// --- list / remove ----------------------------------------------------------------

test("listCatalog reads the manage route (hidden entries included by contract)", async () => {
  const paths = [];
  const fake = async (path) => {
    paths.push(path);
    return { ok: true, skills: [{ slug: "hidden", strength: 0 }] };
  };
  const skills = await listCatalog({ getJson: fake });
  assert.equal(paths[0], "/api/skills-catalog/manage");
  assert.equal(skills[0].strength, 0);
});

test("removeCatalogEntry DELETEs the entry route", async () => {
  const calls = [];
  const fake = async (path, opts) => {
    calls.push({ path, opts });
    return { ok: true };
  };
  await removeCatalogEntry("abc", { apiRequest: fake });
  assert.equal(calls[0].path, "/api/skills-catalog/manage/abc");
  assert.equal(calls[0].opts.method, "DELETE");
  assert.deepEqual(removeArgs(["--id=abc", "--confirm"]), { id: "abc", confirm: true });
});

test("remove.mjs without --confirm refuses in a real process, before credentials", async () => {
  try {
    await run(process.execPath, [join(scriptsDir, "remove.mjs"), "--id=abc"], {
      timeout: 15_000,
      env: {
        ...process.env,
        AI_POWER_GUILD_CREDENTIALS_PATH: join(scriptsDir, "no-such-cred.json"),
      },
    });
    assert.fail("remove.mjs should have exited non-zero");
  } catch (err) {
    assert.equal(err.code, 1);
    assert.match(String(err.stderr), /Refusing to remove without --confirm/);
    assert.ok(!/bearer|authorization/i.test(String(err.stderr)));
  }
});
