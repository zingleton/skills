---
name: guild-catalog
description: >
  Curate the AI Power Guild skills catalog as a guide or admin — add, edit,
  re-pin, hide, or remove catalog entries and their role/task targeting. Use
  when a guide says things like "add this skill to the catalog", "re-pin a
  skill", "change a skill's strength", "hide a catalog entry", or "remove a
  skill from the catalog". This is CURATION — for browsing and INSTALLING
  skills as a member, use guild-skills instead. Builds on guild-connect for
  the account credential.
---

# guild-catalog

Curates the entries that the guild web page and the `guild-skills` installer
serve, through `/api/skills-catalog/manage[/id]` (documented in the app's
`llms.txt`). Guide/admin only. Requires a connected account — run
`guild-connect`'s `connect` first if needed.

All scripts live in `scripts/` (zero dependencies — plain Node 18+). Run them
with `node`. **Stdout is machine-readable JSON; human/status copy and the
`Acting as <email>` banner go to stderr.** Do evaluation and selection
conversationally in chat, then pass finished arguments — the scripts never
prompt.

## Workflow

1. **Evaluate the candidate in chat.** Read the skill's repo, check it follows
   safe conventions, and agree on `name`, `description`, `dependencyNotes`
   (advisory prerequisites), and targeting.
2. **Resolve the pin.** `pinnedCommit` is always a **commit SHA**, never a
   branch — installs fetch exactly that commit, and an author's later push
   reaches members only when a curator re-pins. Resolve it with
   `git ls-remote https://github.com/<owner>/<repo> HEAD` (or a local
   `git rev-parse HEAD` in a checkout you just reviewed — pin what you
   evaluated, not upstream HEAD at install time).
3. **Resolve targeting.** `roleKeys` / `taskIds` come from the public
   `GET /api/intake-options` (`guild-connect`'s `intake.mjs options`), same as
   content tags. `recommendedForAll` marks a skill for every member.
4. **Add hidden, then raise.** `add.mjs` defaults to `strength 0` (hidden).
   Verify an install works (`guild-skills`), then `edit.mjs` the strength up:
   `1` Experimental, `2` Optional, `3` Recommended. Members see strength ≥ 1.
5. **Edit read-merge-write.** Run `list.mjs`, find the entry's `id` and
   `updatedAt`, then `edit.mjs --id=<uuid> <patch.json>` with only the fields
   that change PLUS `updatedAt`. A 409 means another curator got there first —
   re-read and retry. `slug` is immutable (it is the installer's key).
6. **Re-pin surgically.** `repin.mjs --id=<uuid> --commit=<sha>
   --updated-at=<ts>` sends ONLY the pin and the precondition — role/task
   targeting is untouched.
7. **Remove with care.** `remove.mjs --id=<uuid> --confirm` deletes the entry
   (members who installed keep their copy; new installs and updates stop).
   Echo the entry's slug and name and get an explicit yes first. Prefer
   hiding (`strength 0`) when the entry might come back.

## Commands

- `list.mjs` — the full catalog INCLUDING hidden (strength 0) entries, each
  with `id` and `updatedAt`. Connect-first.
- `add.mjs <payload.json|-|'{...}'>` — create an entry. Payload:
  `{"slug","name","sourceRepo":"owner/repo","sourcePath":"skills/<dir>",
  "pinnedCommit":"<sha>","description"?,"dependencyNotes"?,"strength"?,
  "recommendedForAll"?,"roleKeys"?,"taskIds"?,"originalSourceRepo"?,
  "originalSourcePath"?}`. Rejects a non-SHA pin locally. A duplicate source
  409 prints the existing entry's identity — edit that entry instead.
- `edit.mjs --id=<uuid> <patch.json|-|'{...}'>` — partial edit; the patch MUST
  include `updatedAt` from a fresh `list.mjs` read.
- `repin.mjs --id=<uuid> --commit=<sha> --updated-at=<ts>` — move the pin
  only.
- `remove.mjs --id=<uuid> --confirm` — delete the entry.

## Rules

- **Pin what you reviewed.** Never pin a SHA you haven't evaluated; never pass
  a branch name (the scripts reject non-SHA pins before any network call).
- **Curation ≠ installation.** This skill manages the catalog; installing
  skills onto a machine is `guild-skills`.
- **Removal needs a human yes.** `remove.mjs` refuses without `--confirm`;
  pass it only after the guide approved the exact entry in chat.
- **Surface API errors verbatim, and only them.** A duplicate-source 409
  carries `existing` (the surviving entry); a stale 409 means reload and
  retry.
- **Security (inherited from guild-connect):** never print tokens,
  `Authorization` headers, or raw error bodies; never export tokens to env
  vars; surface the `Acting as <email>` banner each session.
