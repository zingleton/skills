// memory-activate.mjs unit tests — per-project memory activation. Pure helpers
// plus the runMemoryActivate orchestrator with injected fs (no real home dir,
// no network). node:test.

import { test } from "node:test";
import assert from "node:assert/strict";
import { join, resolve } from "node:path";

import {
  MemoryActivateError,
  hookBlock,
  mergeSettings,
  installedHookPath,
  runMemoryActivate,
} from "../scripts/memory-activate.mjs";

// --- pure helpers -----------------------------------------------------------

test("hookBlock keeps the absolute path quoted even with a space in it", () => {
  const block = hookBlock("/Users/Andy Smith/.claude/skills/guild-memory/scripts/memory-hook.mjs");
  const recall = block.UserPromptSubmit[0].hooks[0];
  const retain = block.Stop[0].hooks[0];

  assert.match(recall.command, /^node "\/Users\/Andy Smith\/.*memory-hook\.mjs" recall$/);
  assert.match(retain.command, /^node ".*memory-hook\.mjs" retain$/);
  assert.equal(recall.timeout, 15);
  assert.equal(retain.timeout, 20);
});

test("mergeSettings adds the hooks to an empty settings object", () => {
  const merged = mergeSettings({}, hookBlock("/h/memory-hook.mjs"));
  assert.equal(merged.hooks.UserPromptSubmit.length, 1);
  assert.equal(merged.hooks.Stop.length, 1);
});

test("mergeSettings preserves unrelated existing hooks", () => {
  const existing = {
    hooks: {
      UserPromptSubmit: [{ hooks: [{ type: "command", command: "node other.mjs" }] }],
      PreToolUse: [{ hooks: [{ type: "command", command: "node guard.mjs" }] }],
    },
  };
  const merged = mergeSettings(existing, hookBlock("/h/memory-hook.mjs"));

  // Unrelated entries survive.
  assert.equal(merged.hooks.PreToolUse.length, 1);
  assert.ok(merged.hooks.UserPromptSubmit.some((g) => g.hooks[0].command === "node other.mjs"));
  // Memory's recall got appended alongside.
  assert.ok(merged.hooks.UserPromptSubmit.some((g) => /memory-hook\.mjs" recall$/.test(g.hooks[0].command)));
  // existing was not mutated.
  assert.equal(existing.hooks.UserPromptSubmit.length, 1);
});

test("mergeSettings is idempotent — re-merging the same hooks is a no-op", () => {
  const block = hookBlock("/h/memory-hook.mjs");
  const once = mergeSettings({}, block);
  const twice = mergeSettings(once, block);
  assert.equal(twice.hooks.UserPromptSubmit.length, 1);
  assert.equal(twice.hooks.Stop.length, 1);
  assert.deepEqual(twice, once);
});

// --- orchestrator harness ---------------------------------------------------

const SKILLS = "/userskills";
const HOOK = installedHookPath(SKILLS); // /userskills/guild-memory/scripts/memory-hook.mjs

/** Fake fs that records writes and serves seeded files. */
function makeFs(seed = {}) {
  const files = new Map(Object.entries(seed));
  const present = new Set([HOOK, ...Object.keys(seed)]);
  return {
    files,
    deps: {
      exists: async (p) => present.has(p),
      readFile: async (p) => {
        if (!files.has(p)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
        return files.get(p);
      },
      writeFile: async (p, data) => {
        files.set(p, data);
        present.add(p);
      },
      mkdir: async () => {},
    },
  };
}

test("writes settings for the default COF project when no arg is given", async () => {
  const fs = makeFs();
  const result = await runMemoryActivate({ userSkillsDir: SKILLS }, fs.deps);

  assert.equal(result.ok, true);
  assert.match(result.projectDir, /PersonalChiefOfStaff$/);
  assert.match(result.settingsPath, /PersonalChiefOfStaff\/\.claude\/settings\.json$/);
  assert.equal(result.alreadyActive, false);

  // A settings.json was written carrying both capture events.
  const [path] = [...fs.files.keys()].filter((k) => /settings\.json$/.test(k));
  const obj = JSON.parse(fs.files.get(path));
  assert.equal(obj.hooks.UserPromptSubmit.length, 1);
  assert.equal(obj.hooks.Stop.length, 1);
});

test("an explicit project arg targets that project instead", async () => {
  const fs = makeFs();
  const result = await runMemoryActivate(
    { projectDir: "/work/my-proj", userSkillsDir: SKILLS },
    fs.deps,
  );
  assert.match(result.projectDir, /my-proj$/);
  assert.match(result.settingsPath, /my-proj[\\/]\.claude[\\/]settings\.json$/);
  // The written settings carry both capture events with the quoted hook path.
  const [path] = [...fs.files.keys()].filter((k) => /settings\.json$/.test(k));
  const obj = JSON.parse(fs.files.get(path));
  assert.match(obj.hooks.UserPromptSubmit[0].hooks[0].command, /" recall$/);
  assert.match(obj.hooks.Stop[0].hooks[0].command, /" retain$/);
});

test("re-activating an already-active project is a no-op", async () => {
  const fs = makeFs();
  const first = await runMemoryActivate({ projectDir: "/work/p", userSkillsDir: SKILLS }, fs.deps);
  assert.equal(first.alreadyActive, false);
  const second = await runMemoryActivate({ projectDir: "/work/p", userSkillsDir: SKILLS }, fs.deps);
  assert.equal(second.alreadyActive, true);

  const [path] = [...fs.files.keys()].filter((k) => /settings\.json$/.test(k));
  const obj = JSON.parse(fs.files.get(path));
  assert.equal(obj.hooks.UserPromptSubmit.length, 1, "no duplicate recall hook");
  assert.equal(obj.hooks.Stop.length, 1, "no duplicate retain hook");
});

test("missing user-scope install → fails loudly and writes nothing", async () => {
  const fs = makeFs();
  // Remove the hook from the present set to simulate no install.
  const deps = { ...fs.deps, exists: async () => false };
  await assert.rejects(
    () => runMemoryActivate({ projectDir: "/work/p", userSkillsDir: SKILLS }, deps),
    (err) => err instanceof MemoryActivateError && /Install the guild skills/.test(err.message),
  );
  assert.equal([...fs.files.keys()].length, 0, "nothing written");
});

test("merging into a project with unrelated hooks preserves them", async () => {
  // Compute the key exactly as the orchestrator does (resolve + join), so the
  // seeded file is found regardless of host path separators.
  const settingsKey = join(resolve("/work/p"), ".claude", "settings.json");
  const fs = makeFs({
    [settingsKey]: JSON.stringify({
      hooks: { Stop: [{ hooks: [{ type: "command", command: "node cleanup.mjs" }] }] },
    }),
  });
  const result = await runMemoryActivate({ projectDir: "/work/p", userSkillsDir: SKILLS }, fs.deps);
  assert.equal(result.alreadyActive, false);

  const obj = JSON.parse(fs.files.get(settingsKey));
  // Unrelated Stop hook survives; memory's retain is added alongside.
  assert.equal(obj.hooks.Stop.length, 2);
  assert.ok(obj.hooks.Stop.some((g) => g.hooks[0].command === "node cleanup.mjs"));
  assert.ok(obj.hooks.Stop.some((g) => /" retain$/.test(g.hooks[0].command)));
});

test("result JSON carries no token or secret", async () => {
  const fs = makeFs();
  const result = await runMemoryActivate({ projectDir: "/work/p", userSkillsDir: SKILLS }, fs.deps);
  const text = JSON.stringify(result);
  assert.doesNotMatch(text, /token|secret|bearer|authorization/i);
});
