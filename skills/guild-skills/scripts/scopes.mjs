// guild-skills: scope resolution (skills-delivery U5, R10).
//
// A "scope root" is a directory that holds a `skills/` subdir (where installed
// skill folders live) and a `skills-lock.json` provenance lockfile. Three named
// scopes map to roots:
//   project → <cwd>/.claude           (Claude Code project scope — the default)
//   global  → <home>/.claude          (Claude Code user scope; promote target)
//   profile → $AI_POWER_GUILD_PROFILE_DIR (Hermes profile — layout is a config
//             point pending confirmation against a live Hermes instance; unset
//             means "not available here")
//
// All resolvers take an explicit context ({ cwd, home, env }) so tests can point
// them at temp dirs — the CLI mains pass process.cwd()/homedir()/process.env.

import { homedir } from "node:os";
import { join } from "node:path";

const CLAUDE_DIR = ".claude";
export const LOCKFILE_NAME = "skills-lock.json";

export function defaultContext() {
  return { cwd: process.cwd(), home: homedir(), env: process.env };
}

/** Decorate a root directory with its skills dir and lockfile path. */
function decorate(scope, root) {
  return { scope, root, skillsDir: join(root, "skills"), lockfile: join(root, LOCKFILE_NAME) };
}

/**
 * Resolve a single named scope to its root descriptor. Throws for an unknown
 * scope name or a profile scope with no configured directory.
 */
export function resolveScope(scope, ctx = defaultContext()) {
  switch (scope) {
    case "project":
      return decorate("project", join(ctx.cwd, CLAUDE_DIR));
    case "global":
      return decorate("global", join(ctx.home, CLAUDE_DIR));
    case "profile": {
      const dir = ctx.env.AI_POWER_GUILD_PROFILE_DIR;
      if (!dir || dir.trim() === "") {
        throw new Error(
          "Profile scope needs AI_POWER_GUILD_PROFILE_DIR set to the Hermes profile directory.",
        );
      }
      return decorate("profile", dir);
    }
    default:
      throw new Error(`Unknown scope "${scope}". Use project, global, or profile.`);
  }
}

/**
 * Every scope root that could hold installed skills on this machine: project +
 * global always, profile only when configured. status / uninstall / update
 * enumerate all of them so a skill is found regardless of where it was installed.
 */
export function allScopes(ctx = defaultContext()) {
  const roots = [resolveScope("project", ctx), resolveScope("global", ctx)];
  if (ctx.env.AI_POWER_GUILD_PROFILE_DIR && ctx.env.AI_POWER_GUILD_PROFILE_DIR.trim() !== "") {
    roots.push(resolveScope("profile", ctx));
  }
  return roots;
}
