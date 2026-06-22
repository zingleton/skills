---
date: 2026-06-22
topic: cof-portable-repo-guided-setup
---

# Guided Setup + Portable Personal Repo for the Chief of Staff

## Summary

Make first-run setup a single guided, re-runnable flow — a preflight *doctor*
checks the environment, then `guild-connect` orchestrates connect → git-setup →
clone the `personal` repo → scaffold the Chief of Staff (COF). Move the COF's
durable personal layer (memory, skills, Tools) into the cloned `personal` repo so
it is version-controlled and portable across AI installations, and repoint the
COF config at it.

---

## Problem Frame

Two things lose members today. **Install is fragile at exactly the wrong
moment** — the first run. The two observed failure modes are plugin
install/update (the marketplace step fails, installs a stale version, or an
update doesn't pick up a new release) and a missing toolchain (no Node 18+ or no
git on PATH), which surfaces as a cryptic script error instead of a clear
"install this first." A member who hits either before getting any value tends not
to come back.

**The COF's accumulated value isn't portable.** Memory, the assistant's
self-built scripts (`Tools/`), and any skills live inside one project folder on
one machine. The member already gets a server-side `personal` repo on Forgejo
(`git-setup.mjs` already makes it clone/push without a prompt), but nothing puts
the COF's durable layer into it — so memory and capability can't follow the
member to a second machine or a second AI installation.

---

## Key Decisions

- **Orchestrate through `guild-connect`, not a new skill.** It is already the
  front door members invoke ("connect my guild account") and already hands off to
  `claudecof-setup`. Its choreography is extended to drive the full guided
  sequence. A dedicated umbrella skill is revisited only if the orchestration
  grows large enough that `guild-connect` reads as two skills.
- **The doctor is a shared `doctor.mjs` script** under
  `skills/guild-connect/scripts/`, so any skill can run the same preflight first.
  Its plugin-freshness check reuses the existing `stale_skill` signal rather than
  inventing a second version mechanism.
- **The cloned repo is the COF's memory**, file-based on the Anthropic-standard
  pattern (a `MEMORY.md` index plus one-fact-per-file). Hindsight portable memory
  stays installed and its capture hooks keep running, but the COF depends only on
  the repo files. Extracting facts from file memory into Hindsight is later work.
- **Only the durable cross-assistant layer travels.** The portable repo is a
  `repo/` subfolder holding `memory/`, `skills/`, and `Tools/`. `CLAUDE.md` and
  `Notes/` stay local and outside the repo — they are regenerated from the skill
  or are session-local, so each AI installation wraps its own config around the
  shared layer.
- **Tools and skills are the same kind of thing at different formality levels.**
  `Tools/` holds informal instructions/scripts; `skills/` holds fully-formatted
  agent skills. An informal Tool can graduate into a packaged skill. Both are
  durable personal capability, so both live in the portable repo.
- **Seed-only-if-absent.** A fresh `personal` repo is empty; setup seeds it and
  pushes, but never clobbers content that is already there.

### Target layout

```
<project>/
├── CLAUDE.md          # COF config — regenerated from the skill, local
├── repo/              # clone of the member's Forgejo `personal` repo (portable)
│   ├── memory/        # MEMORY.md index + one-fact-per-file
│   ├── skills/        # fully-formatted agent skills
│   └── Tools/         # informal instructions/scripts (skills-in-waiting)
└── Notes/             # session notes + getting-started guide — local
```

---

## Requirements

### Guided setup and the doctor

- R1. A preflight doctor runs before any setup step and checks: Node ≥ 18
  present, git present, and the installed plugin is current. On any failure it
  prints a clear, copy-pasteable fix and stops, rather than letting a later step
  fail cryptically.
- R2. The doctor's plugin-freshness check reuses the existing `stale_skill`
  signal; it does not introduce a separate version-check mechanism.
- R3. `guild-connect` drives the full first-run sequence as one guided flow:
  doctor → connect → git-setup → clone `personal` repo → scaffold COF. No new
  top-level skill is introduced.
- R4. The doctor is a shared script (`doctor.mjs`) under
  `skills/guild-connect/scripts/`, callable as a first step by any skill.
- R5. The guided flow is idempotent and resumable: re-running is safe and resumes
  from the first incomplete step instead of repeating completed steps or erroring.
- R6. Every setup step emits a clear, actionable message on failure (missing
  Node/git → install guidance; failed clone → what to retry), honoring
  `guild-connect`'s redaction rules — no tokens, headers, or raw error bodies.

### Portable personal repo

- R7. Setup clones the member's existing Forgejo `personal` repo into a `repo/`
  subfolder of the COF project.
- R8. The portable repo holds the durable personal layer: `memory/` (MEMORY.md
  index + one-fact-per-file), `skills/` (full agent skills), and `Tools/`
  (informal instructions/scripts).
- R9. Memory uses the Anthropic-standard file convention — a `MEMORY.md` index
  plus one-fact-per-file with frontmatter. This replaces the prior project-root
  memory format (`memory.md` + `context.txt` + `conversations/`) for new
  projects.
- R10. On first setup the repo is seeded (initial `MEMORY.md`, `skills/`,
  `Tools/` scaffolding) and pushed. Seeding is seed-only-if-absent: a re-run, or
  setup on a second machine against an already-populated repo, never overwrites
  existing content.
- R11. The COF reads and writes memory, skills, and Tools in `repo/` only; that
  is the single source for those concerns. `CLAUDE.md` and `Notes/` remain local
  and outside the repo.
- R12. An informal `Tools/` instruction can be promoted into a packaged
  `skills/` skill; both are discoverable to the COF.

### COF config repointing

- R13. The COF `CLAUDE.md` file-sharing instructions point at `repo/memory/` —
  read memory there first, write learnings there — not the old project-root
  `memory/`.
- R14. The COF is instructed to create new capability as project-scoped skills in
  `repo/skills/`, asking the member before creating, and to use skills already
  present there.
- R15. The COF is instructed to look in `repo/Tools/` for informal instructions
  and to promote a Tool to a skill when it is worth packaging.

---

## Key Flows

- F1. First run, fresh member and machine
  - **Trigger:** Member runs the connect flow for the first time.
  - **Steps:** Doctor verifies Node/git/plugin and stops with fixes if anything
    is missing → `guild-connect` connects the account → `git-setup` installs the
    durable git credential → setup clones the (empty) `personal` repo into
    `repo/`, seeds `memory/`, `skills/`, `Tools/`, and pushes → `claudecof-setup`
    scaffolds `CLAUDE.md` and `Notes/` pointing at `repo/`.
  - **Outcome:** A working COF whose durable layer is committed and pushed.
- F2. Second machine or re-run
  - **Trigger:** Member runs setup again, or on another machine, with a
    `personal` repo that already has content.
  - **Steps:** Doctor + connect + git-setup as above → setup clones the populated
    `personal` repo → seeding is skipped where content exists (seed-only-if-
    absent) → COF scaffolding points at the cloned `repo/`.
  - **Outcome:** Memory, skills, and Tools from the first machine are present;
    nothing is clobbered.

---

## Scope Boundaries

### Deferred for later

- The broader COF config rework — commands and practices for reading email,
  prioritizing communications, and meeting prep. This phase only repoints the
  COF's file-sharing instructions (R13–R15).
- Extracting facts from file memory into Hindsight.
- Migrating existing old-layout COF projects to the new `repo/` structure (this
  phase targets new projects).

### Outside this phase's identity

- Replacing or retiring Hindsight portable memory. It stays installed and capture
  hooks keep running; the COF simply does not depend on it.

---

## Dependencies / Assumptions

- The member's Forgejo `personal` repo exists and is reachable; `git-setup.mjs`
  has installed a working durable git credential before the clone step.
- Hindsight capture hooks remain fail-open and never block the session, unchanged
  by this work.
- `Notes/` stays local on the assumption the getting-started guide is
  regenerated from the skill and session notes are machine-local; revisit if
  session decisions prove durable enough to travel.

---

## Outstanding Questions

### Deferred to planning

- **How `repo/skills/` becomes loadable by the host AI.** Claude Code discovers
  project skills under `.claude/skills/`; the mechanism that makes
  `repo/skills/` discoverable (symlink, generated pointer, config) is a planning
  decision. The product behavior is fixed (R12, R14).
- **Resumability mechanics for R5** — how the guided flow records which steps
  completed so a re-run resumes correctly.
- **Migration path** for existing projects on the old project-root `memory/`
  format, if/when that moves out of "deferred."
