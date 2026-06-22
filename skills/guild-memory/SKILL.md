---
name: guild-memory
description: >
  Opt-in portable memory for the member's AI Power Guild account, backed by the
  Guild's self-hosted Hindsight server. Use when the member says things like
  "set up my guild memory", "turn on memory for this project", "activate guild
  memory", "search my memory", "what do you remember about me", "list my
  memories", or "forget that". Memory is off until the member activates it for a
  specific project — onboarding never turns it on.
---

# guild-memory

The member's **portable memory** — a personal memory that follows them across
Claude Code sessions (and, later, other assistants). It is the memory
counterpart to the git skills repo: skills are curated and version-controlled;
memory accumulates automatically. Memory is **opt-in and per-project**: it
captures nothing until the member activates it for a chosen project, and even
then only in that project.

This skill reuses `guild-connect`'s shared plumbing — its scripts import
`credentials.mjs` and `api.mjs` from `../../guild-connect/scripts/`, so
`guild-connect` must be installed as a sibling skill (the user-scope installer
always installs both together). The member must `connect` their guild account
(via `guild-connect`) before memory works.

## Commands

All scripts live in `scripts/` (zero dependencies — plain Node 18+). Run them
with `node`. Stdout is machine-readable JSON; human/status copy and the
`Acting as <email>` banner go to stderr. Never a token.

| Command | What it does |
| --- | --- |
| `node scripts/memory-setup.mjs` | One-time per machine: connects the member's portable memory. Calls `/api/account/memory-access` with the stored Guild credential, records the returned data-plane URL + bank id in `~/.config/ai-power-guild/memory.json` (no secret), and verifies a connection. Stdout `{ok, dataPlaneUrl, bankId}`. Re-running just re-verifies. |
| `node scripts/memory-activate.mjs [<projectDir>]` | Turns memory ON for one project by writing the `UserPromptSubmit`/`Stop` capture hooks into that project's `.claude/settings.json`. Default target is the COF project. Merges without clobbering existing hooks; idempotent (re-running does not duplicate). Resolves a **quoted absolute path** to the user-scope-installed `memory-hook.mjs` and **fails loudly** if that install is absent. Stdout reports what was written. |
| `node scripts/memory.mjs <search\|list\|export\|forget>` | Manage the member's memory. `search <query>` → semantic matches (each with a `document_id`); `list [--limit N]` → stored memories; `export` → the whole corpus as JSON; `forget <documentId>` → delete one memory by its source document. Requires `memory-setup`. To forget something, `search` for it first, then `forget` the matching `document_id`. |

## How it works

- **Setup** (`memory-setup.mjs`) records the member's data-plane endpoint
  locally — no token is stored. Run it once per machine; the durable Guild
  credential supplies the rotating access token at call time.
- **Activation** (`memory-activate.mjs`) is the explicit opt-in. It writes two
  Claude Code hooks into the *target project's* `.claude/settings.json`:
  - `UserPromptSubmit` → recall: inject relevant memory into the prompt.
  - `Stop` → retain: store the latest exchange.
  Each hook mints a **fresh** access token from the durable Guild credential per
  run — there is no static token to rotate or leak. The hooks are
  **project-scoped**: they fire only in the activated project, never globally.
- **Fail-open by design.** If memory isn't set up, the network is down, or a
  call is slow, the hooks exit silently and never block or break the session.
- **Per-member isolation.** The member's token scopes every call to their own
  memory; no other member can read or write it. Account deletion deletes their
  memory (right-to-delete); "Disconnect connected devices" ends the sessions
  that authorize capture.

## Activating memory for a project

Activation is a deliberate step the member opts into — **onboarding never does
it.** Enabling capture is gated on latency testing of the hooks; until that
clears, treat activation as available-but-advanced.

1. Ensure `memory-setup.mjs` has run on this machine (and `guild-connect` is
   connected).
2. `node scripts/memory-activate.mjs [<projectDir>]` — with no argument it
   targets the COF project; pass a project directory to target that instead.
3. It writes the capture hooks into `<projectDir>/.claude/settings.json` using a
   quoted absolute path into the user-scope install
   (`~/.claude/skills/guild-memory/scripts/memory-hook.mjs`). If that install is
   missing, it errors and writes nothing — re-run the guild installer first.
4. Re-running activation is a no-op (idempotent). Memory now fires only in that
   project.

## Managing memory (`memory.mjs`)

This is the member's primary, agent-native surface for their memory — richer
than the web `/memory` page (which only offers export + delete-all). When the
member asks to recall, review, or forget things:

- **Search / recall:** `node scripts/memory.mjs search "<what they asked about>"`
  → matches, each with a `document_id`. (Once activated, capture/recall also
  happens automatically via the hooks; this is the explicit query path.)
- **List:** `node scripts/memory.mjs list [--limit N]` → stored memories.
- **Forget:** to honor "forget X / delete that," FIRST `search` for it, then
  `forget <document_id>` from a match. Confirm the right entry with the member
  before deleting. Entries with no `document_id` (derived observations) can't be
  forgotten individually — point the member at the web page's "Delete all" for a
  full reset.
- **Export:** `node scripts/memory.mjs export` → the whole corpus as JSON the
  member can save. Never paste a member's memory contents anywhere they didn't
  ask.

## Hard rules

- **Never print tokens or raw error bodies.** No access/refresh tokens, no
  `Authorization` headers — quote only the scripts' own JSON output. The scripts
  redact; you must too.
- **Memory is opt-in.** Do not activate memory as part of onboarding or without
  the member asking. Activation is per-project and deliberate.
- **Per environment:** run `memory-setup` on each machine (it records that
  machine's endpoint; the durable Guild credential supplies the rotating token).
- **Requires the sibling `guild-connect` skill** for credential/refresh and API
  plumbing. If only `guild-memory` is installed, its imports fail — install via
  the guild installer, which always installs both together.
- Codex / other harnesses are not auto-configured yet — they expect a static
  token, which the short-lived-token model doesn't fit; that integration is
  separate (future work).
