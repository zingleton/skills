---
name: guild-skills
description: >
  Browse and install AI Power Guild skills recommended for the member, keep them
  updated, and harvest personalized skills into their personal repository. Use
  when the member says things like "install guild skills", "what skills do you
  recommend", "install the chief of staff", "update my guild skills", "uninstall
  a skill", "promote a skill to global", or "save my personalized skill". Builds
  on guild-connect for the account credential.
---

# guild-skills

Installs guild-catalog skills onto this AI client at curator-pinned commits,
with a provenance lockfile, member-triggered updates, and harvest of
personalized skills into the member's personal Forgejo repo. Requires a
connected account — run `guild-connect`'s `connect` first if needed.

All scripts live in `scripts/` (zero dependencies — plain Node 18+). Run them
with `node`. **Stdout is machine-readable JSON; human/status copy and the
`Acting as <email>` banner go to stderr.** Do the selection conversationally in
chat, then pass the chosen slugs to the scripts — the scripts never prompt.

## Workflow

1. **Show recommendations.** Run `node scripts/catalog.mjs`. Present the returned
   skills to the member: name, strength (Recommended / Optional / Experimental),
   the relevance chip (for everyone / your role / your task), the description,
   and any `dependencyNotes` (advisory — installing is never blocked on them).
   Each skill has a `slug`.
2. **Install the chosen skills.** Run
   `node scripts/install.mjs --slugs=<a,b>` (default project scope). Add
   `--scope=global` for user scope or `--scope=profile` for a Hermes profile.
   Report the per-skill results.
3. **Update later.** `node scripts/update.mjs` reports what changed; re-run with
   `--apply --slugs=<a,b>` to re-pin the approved skills.
4. **Uninstall / promote / harvest** as the member asks (below).

## Commands

- `catalog.mjs` — list the member's recommendations (bearer API). Connect-first.
- `install.mjs --slugs=a,b [--scope=project|global|profile] [--force]` — fetch
  each skill at its catalog pin and install atomically; write the lockfile.
  `--force` overwrites a locally-modified skill (discarding changes).
- `update.mjs [--apply --slugs=a,b] [--scope=...]` — report or apply updates
  against current catalog pins (forks skipped; locally-modified skills blocked).
- `uninstall.mjs --slugs=a,b [--force]` — remove a skill's files and lockfile
  entry from every scope. `--force` removes a locally-modified skill.
- `promote.mjs --slugs=a,b` — move a project-scope skill to global scope (Claude
  Code only in v1).
- `status.mjs` — list installed skills, their scope, pin, fork flag, and whether
  the on-disk copy is clean / modified / missing. Read-only, no network.
- `harvest.mjs --slug=a` — push a personalized skill to the member's personal
  Forgejo repo and mark it a fork (excluded from updates).

## Rules

- **Curator-owned pins.** Install and update always fetch the commit the catalog
  records, never upstream HEAD. An author's fix reaches the member only when a
  curator re-pins.
- **Never overwrite a member's edits silently.** Update, reinstall, and
  uninstall refuse on a locally-modified skill unless `--force`; offer harvest
  (keep the changes) or discard.
- **Harvested forks stop receiving updates** and keep a pointer to their
  original source.
- **Security (inherited from guild-connect):** never print tokens, `Authorization`
  headers, or raw error bodies; surface the `Acting as <email>` banner.
