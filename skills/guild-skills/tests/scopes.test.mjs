// guild-skills: scope resolution tests (U5, R10; AE6 structural — profile scope).
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { resolveScope, allScopes } from "../scripts/scopes.mjs";

const ctx = (env = {}) => ({ cwd: "/proj", home: "/home/u", env });

test("project scope roots under <cwd>/.claude", () => {
  const r = resolveScope("project", ctx());
  assert.equal(r.root, join("/proj", ".claude"));
  assert.equal(r.skillsDir, join("/proj", ".claude", "skills"));
  assert.equal(r.lockfile, join("/proj", ".claude", "skills-lock.json"));
});

test("global scope roots under <home>/.claude", () => {
  const r = resolveScope("global", ctx());
  assert.equal(r.skillsDir, join("/home/u", ".claude", "skills"));
});

test("profile scope honors AI_POWER_GUILD_PROFILE_DIR (Hermes target — AE6)", () => {
  const r = resolveScope("profile", ctx({ AI_POWER_GUILD_PROFILE_DIR: "/hermes/p1" }));
  assert.equal(r.scope, "profile");
  assert.equal(r.skillsDir, join("/hermes/p1", "skills"));
});

test("profile scope without the env var is an error", () => {
  assert.throws(() => resolveScope("profile", ctx()), /AI_POWER_GUILD_PROFILE_DIR/);
});

test("an unknown scope name is an error", () => {
  assert.throws(() => resolveScope("nope", ctx()), /Unknown scope/);
});

test("allScopes covers project+global, and profile only when configured", () => {
  assert.deepEqual(
    allScopes(ctx()).map((r) => r.scope),
    ["project", "global"],
  );
  assert.deepEqual(
    allScopes(ctx({ AI_POWER_GUILD_PROFILE_DIR: "/hermes/p1" })).map((r) => r.scope),
    ["project", "global", "profile"],
  );
});
