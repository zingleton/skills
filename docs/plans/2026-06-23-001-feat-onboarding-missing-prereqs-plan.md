---
date: 2026-06-23
status: completed
origin: docs/brainstorms/2026-06-23-onboarding-missing-prereqs-requirements.md
---

# feat: Onboarding path for missing Node and git

## Summary

Add a missing-prerequisites path to guild onboarding so a brand-new member
without Node or git isn't a dead end. When the choreography detects either is
missing, the agent offers to install it — OS-aware, with the member's consent —
verifies, and continues the same session; when it can't, it degrades through
guided manual install to a file-only Chief of Staff scaffold that clearly flags
what's deferred. The change is concentrated in two `SKILL.md` choreographies and
the onboarding prompt, with one small `doctor.mjs` copy alignment.

---

## Problem Frame

The onboarding scripts are zero-dependency Node 18+ `.mjs` files run via `node`,
and the durable-repo / guild-git steps need git. Some new members arrive with
neither. Today that produces a silent downgrade: in the observed session, Claude
saw "Node.js isn't installed," concluded it couldn't run the guild scripts, and
hand-scaffolded the Chief of Staff with file operations only — never offering to
install Node, never explaining what was lost (guild connect, git access, the
portable repo).

The root cause is a choreography gap, not a capability gap. Claude Code has shell
tools and can run `winget install`, `xcode-select --install`, etc. The skill
never told it to try. Two structural facts shape the fix:

1. **`doctor.mjs` can't be the gate for a missing-Node machine** — it's itself a
   Node script that can't start. `skills/guild-connect/SKILL.md` already hints at
   this ("a shell-level `node --version` check precedes it"), but the precede-check
   is mentioned, not specified, and has no install branch.
2. **`doctor.mjs` already detects the other two cases** — it runs when Node is
   present, so it owns "Node present but too old" and "git missing," and already
   emits manual-install `fix` strings (`skills/guild-connect/scripts/doctor.mjs`,
   `checkEnv`). Those strings tell the member to install it *themselves and
   re-run* — which will contradict the new agent-installs posture unless aligned.

This is primarily a documentation/choreography change. No new scripts.

---

## Requirements

Traces to origin `docs/brainstorms/2026-06-23-onboarding-missing-prereqs-requirements.md`.

**Detection and gating**

- R1. A shell-level prereq gate (`node --version`, `git --version`) runs before
  any `.mjs` in the onboarding choreography (origin R1).
- R2. The gate distinguishes missing / present-but-too-old (Node < 18) / adequate;
  too-old Node is treated like missing for install purposes (origin R2). Once Node
  is present, `doctor.mjs` remains the deeper preflight and owns the git + node-major
  checks (origin Key Decisions, shell-gate point).
- R3. When both prerequisites are adequate, onboarding proceeds unchanged — no
  added friction for the equipped member (origin R3).

**Agent-driven install and fallback**

- R4. On a missing/inadequate prerequisite the agent detects the OS, proposes the
  OS-appropriate install, and asks consent before running anything; the exact
  command is shown and nothing installs silently or self-elevates (origin R4, R5).
- R5. After install the agent re-verifies adequacy, handling the "installed but
  not yet on PATH in this shell" case by guiding a fresh-shell re-run rather than
  retry-looping, with bounded verification attempts (origin R6, R7, R8).
- R6. When agent install can't proceed (no rights/package manager, failure, or
  decline) the agent falls back to guided manual install, then re-checks (origin R9).
- R7. When the member still can't or won't install, onboarding degrades to a
  file-only Chief of Staff scaffold and continues, stating what's deferred (guild
  connect, git access, portable `repo/`) and how to resume — install, then re-run
  the onboarding one-liner; the idempotent choreography picks up the deferred
  steps (origin R10, R11).

**Placement and copy**

- R8. The missing-prereq path lives primarily in `skills/guild-connect/SKILL.md`;
  `skills/claudecof-setup/SKILL.md`'s preflight references the same gate and
  degrade behavior so both entry points behave identically (origin R12).
- R9. `docs/onboarding-prompt.md`'s "Requires Node 18+ and git" line reflects that
  the skill now helps install them (origin R13).
- R10. `doctor.mjs`'s `fix` strings align with the agent-installs posture (offer
  to install, not only "install it yourself and re-run") so script copy and
  choreography agree.
- R11. The first-run one-liner path resolves a missing git *before* it clones.
  Obtaining the choreography on a fresh machine needs `git clone`, so when the
  plugin isn't installed yet and git is absent, the agent installs git (with
  consent) driven by the onboarding prompt's own text — the one instruction the
  member already has in hand — then clones and proceeds. A Node-missing first run
  is unaffected: the clone needs git, not Node, and the shell gate (R1) catches
  Node after the clone.

---

## Key Technical Decisions

- **Pure-choreography gate, no new script.** The shell-level check is authored as
  choreography prose instructing the agent to run `node --version` / `git --version`
  at the shell and branch on the result. A node-free detect helper was rejected as
  heavier and against the origin's "no new scripts" boundary. (origin Scope
  Boundaries; confirmed at synthesis.)

- **Two detection surfaces, one install posture.** The shell gate catches Node
  fully missing (where `doctor.mjs` can't start); `doctor.mjs` catches git-missing
  and Node-too-old. Both route into the *same* agent-install-with-consent branch in
  the choreography — the agent reacts to a failed shell check or a `doctor.mjs`
  check with `ok: false` identically, rather than only surfacing the `fix` and
  stopping.

- **Agent owns OS detection and command choice.** The agent already knows the
  platform and has shell tools; the choreography names the per-OS install paths as
  directional guidance (see High-Level Technical Design) without a detection script.

- **doctor.mjs change is copy-only.** The `checkEnv` structure, exit codes, and
  JSON shape are unchanged; only the `fix` string wording is adjusted. The
  existing tests assert on `fix`-string *content* (substring checks), so they need
  text-expectation updates only — no structural assertion changes, consistent with
  the copy-only claim.

- **Bootstrap ordering: git-before-clone on a fresh machine.** Two entry paths
  reach the gate. When the plugin is already installed (user-scope or marketplace),
  `SKILL.md` is local and the gate runs even with git missing. On the first-run
  one-liner with nothing installed, the agent must `git clone` to obtain the
  choreography — so a no-git first run can't reach the in-repo gate. The onboarding
  prompt itself carries the minimal git-install instruction for that one case; the
  richer in-repo choreography handles every case after the clone. This keeps the
  "no new scripts" boundary intact and avoids a chicken-and-egg dead end.

---

## High-Level Technical Design

Prereq resolution flow (directional — exact wording lives in the choreography):

```
onboarding start
   │
   ▼
shell gate:  node --version  /  git --version
   │
   ├─ both adequate ──────────────► doctor.mjs ──► existing choreography (connect …)
   │                                   │
   │                                   └─ git missing / node<18 ─┐
   │                                                             │
   └─ node missing / node<18 ───────────────────────────────────┤
                                                                 ▼
                                                   offer agent install (consent)
                                                                 │
                                          ┌──────────────────────┼───────────────────────┐
                                          ▼                      ▼                       ▼
                                   consent + success      can't / declines         installed, not on PATH
                                          │                      │                       │
                                   re-verify ✓             guided manual install    guide fresh-shell re-run
                                          │                      │                  (bounded attempts; no loop)
                                          ▼                      ▼
                              continue choreography      still can't/won't
                                                                 │
                                                                 ▼
                                              file-only COF scaffold + deferred-steps notice
```

Per-OS install guidance (directional; verify exact package IDs at implementation):

| OS | Node 18+ | git |
| --- | --- | --- |
| Windows | `winget install OpenJS.NodeJS.LTS` | `winget install Git.Git` |
| macOS | official `.pkg` from nodejs.org, or Homebrew if present | `xcode-select --install` (Command Line Tools), or Homebrew if present |
| Linux | distro package manager; NodeSource when distro Node < 18 | distro package manager (`apt-get`/`dnf` install git) |

Manual fallback uses the official installer URLs already in `doctor.mjs`'s `fix`
strings (nodejs.org, git-scm.com/downloads).

---

## Implementation Units

### U1. guild-connect choreography — shell gate, agent install, fallback ladder

- **Goal:** Add the missing-prereq path to the onboarding spine: the shell-level
  gate before `doctor.mjs`, the agent-install-with-consent branch (reached from
  both the shell gate and `doctor.mjs` failures), and the three-rung fallback to
  file-only degrade with a resume notice.
- **Requirements:** R1–R8, R10 (reaction to doctor output).
- **Dependencies:** none.
- **Files:** `skills/guild-connect/SKILL.md`.
- **Approach:** In the "Choreography" section, expand the existing preamble that
  says "Run `doctor.mjs` FIRST … a shell-level `node --version` check precedes it"
  into a specified Step 0: run `node --version` / `git --version`; branch on
  missing / too-old / adequate (R2). Specify the agent-install-with-consent
  behavior (detect OS, show exact command, ask first, never self-elevate, respect
  no), the re-verify + PATH/fresh-shell handling with bounded attempts, the guided-
  manual fallback, and the file-only degrade with the deferred-steps notice and the
  re-run-the-one-liner resume. State that a failed shell check and a `doctor.mjs`
  check with `ok: false` both route into the same install branch. Keep the security
  posture consistent with the existing "Hard rules" (consent, no silent elevation).
  U1 owns embedding the per-OS commands from the High-Level Technical Design table
  into the choreography prose so the install branch is self-contained — the
  "deferred to implementation" items (Open Questions) are exact package-ID
  verification and re-attempt counts, not the existence of the commands.
- **Patterns to follow:** The existing degrade-gracefully prose in
  `skills/claudecof-setup/SKILL.md` ("Degrade gracefully", "Guild integration is
  optional"); the re-runnable/idempotent framing already in this file's
  Choreography preamble; the consent-and-approval tone of guild-connect's profile
  and avatar steps.
- **Test scenarios:** Test expectation: none — choreography prose, no executable
  behavior. Validate by walking origin AE1–AE5 against the written steps (every
  acceptance example has a corresponding branch in the choreography).
- **Verification:** A reader following the Choreography on a no-Node machine has an
  explicit, consent-gated install path and never reaches a dead end; the equipped-
  member path is unchanged.

### U2. claudecof-setup preflight — reference the shared gate and degrade

- **Goal:** Make the Chief-of-Staff entry point behave identically when Node/git
  are missing, instead of its current "Node.js isn't installed, so I'll create
  files directly" silent downgrade.
- **Requirements:** R7 (degrade), R8 (shared gate).
- **Dependencies:** U1 (defines the gate/branch this references).
- **Files:** `skills/claudecof-setup/SKILL.md`.
- **Approach:** In "### 1. Preflight and pick the project location," before the
  `doctor.mjs` line, point at guild-connect's Step 0 shell gate and agent-install
  branch as the handler for missing prerequisites. Keep claudecof-setup's existing
  "guild integration is optional / fall back to interview" degrade, but make the
  file-only path explicitly state what's deferred and that installing Node+git then
  re-running unlocks guild connect, git access, and the portable repo (R7), rather
  than scaffolding silently. Do not duplicate the install choreography — reference
  it.
- **Patterns to follow:** This file's existing "Degrade gracefully" and "Guild
  integration is optional" hard rules; the cross-skill reference style already used
  for `../guild-connect/scripts/`.
- **Test scenarios:** Test expectation: none — choreography prose. Validate that
  origin AE4 (member declines install) maps to claudecof-setup's file-only path
  with a deferred-steps notice.
- **Verification:** Starting from a Chief-of-Staff request on a no-Node machine,
  the member is offered an install before any file-only fallback, and the fallback
  names what's deferred.

### U3. Onboarding prompt — update the prerequisites line

- **Goal:** Stop presenting Node 18+ and git as assumed-present prerequisites;
  state the skill helps install them.
- **Requirements:** R9, R11.
- **Dependencies:** U1.
- **Files:** `docs/onboarding-prompt.md`.
- **Approach:** Revise the closing "Requires Claude Code, Node 18+, and git on
  your PATH" line so it says the skill will help install Node and git if they're
  missing (Claude Code itself still required). Add the git-before-clone bootstrap
  note (R11): on a first run where the plugin isn't installed and git is absent,
  the agent installs git (with consent) before cloning, since the clone is how the
  in-repo choreography is obtained. Keep the "What happens" section consistent with
  the new path.
- **Patterns to follow:** The file's existing concise, member-facing voice.
- **Test scenarios:** Test expectation: none — documentation prose.
- **Verification:** The prompt no longer reads as a hard prerequisite wall for a
  member who lacks Node/git.

### U4. doctor.mjs — align fix-string copy with agent-installs posture

- **Goal:** Make `doctor.mjs`'s failing-check copy agree with the choreography —
  the member can ask the agent to install, not only "install it yourself and
  re-run."
- **Requirements:** R10.
- **Dependencies:** none (copy change; U1 defines the posture it must match).
- **Files:** `skills/guild-connect/scripts/doctor.mjs`,
  `skills/guild-connect/tests/doctor.test.mjs`.
- **Approach:** Adjust the two `fix` strings in `checkEnv` (node, git) so each
  notes the agent can install it with consent, while retaining the official
  installer URL and the reopen-terminal guidance as the manual fallback. No change
  to `checkEnv`'s structure, the `ok` logic, exit codes, or JSON shape. Preserve
  the old-Node syntax baseline constraint documented at the top of the file. Keep
  the copy agent-neutral (e.g. "ask your AI to install it, or install it yourself
  from …") so it stays correct on the human-at-terminal path (`connect.mjs`) as
  well as the agent harness.
- **Patterns to follow:** Existing `fix` string format in `checkEnv`; the existing
  assertion style in `doctor.test.mjs`.
- **Test scenarios:**
  - Covers R10. Node-missing (`nodeVersion: null`) → `node` check `ok: false`,
    `fix` non-null and mentions both the agent-install option and the nodejs.org
    fallback URL.
  - Covers R2/R10. Node too old (`nodeVersion: 16`) → `node` check `ok: false`
    with the same fix shape.
  - Covers R10. git absent (`gitExists: false`) → `git` check `ok: false`, `fix`
    mentions the agent-install option and the git-scm.com fallback URL.
  - Regression: both adequate (`nodeVersion: 18`, `gitExists: true`) →
    `ok: true`, both `fix` values null (no copy leaks into the success path).
  - Regression: aggregate `ok` is false when any check fails (unchanged logic).
- **Verification:** `npm test` passes with updated assertions; the JSON contract
  and exit codes are unchanged.

---

## Scope Boundaries

In scope: the four units above — the choreography path, the cross-skill
reference, the prompt line, and the doctor copy alignment.

### Deferred to Follow-Up Work

- A node-free detection helper script (rejected in favor of pure choreography).
- Version-drift / plugin-freshness detection (already out of scope per
  `doctor.mjs`'s header note).

### Outside this scope (from origin)

- Rewriting the `.mjs` scripts to remove the Node dependency or bundling a
  runtime — the scripts stay Node.
- Install support for non-Claude-Code assistants — the guidance assumes Claude
  Code's shell tools.
- Guaranteeing a universal installer where a platform has no usable package
  manager and no completable official-installer path — the ladder lands on
  file-only degrade instead.

---

## Open Questions

**Deferred to Planning → Implementation**

- Exact per-OS commands and the macOS git path (Xcode CLT vs Homebrew vs official
  `.pkg`), including whether to attempt a Homebrew bootstrap or prefer official
  installers when Homebrew is absent. Captured directionally in High-Level
  Technical Design; confirm exact package IDs when writing U1.
- The precise number of verification re-attempts (R5) and the per-OS fresh-shell
  wording — choreography-level detail settled while writing U1.

---

## Sources & Research

- `skills/guild-connect/SKILL.md` — Choreography section (Step ordering,
  doctor-first preamble, re-runnable framing) and Hard rules (consent posture).
- `skills/claudecof-setup/SKILL.md` — Preflight step and the existing degrade-
  gracefully / guild-optional rules to mirror.
- `skills/guild-connect/scripts/doctor.mjs` — `checkEnv` and its `fix` strings;
  the old-Node syntax-baseline constraint; the "shell-level `node --version`
  check precedes it" note that U1 specifies.
- `skills/guild-connect/tests/doctor.test.mjs` — assertion style for the U4 copy
  updates.
- Origin requirements: `docs/brainstorms/2026-06-23-onboarding-missing-prereqs-requirements.md`.
