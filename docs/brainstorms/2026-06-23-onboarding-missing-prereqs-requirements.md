---
date: 2026-06-23
topic: onboarding-missing-prereqs
---

# Onboarding when Node and git are missing

## Summary

Add a missing-prerequisites path to guild onboarding so a brand-new user
without Node or git isn't a dead end. When the skill detects either is absent,
the agent offers to install it — OS-aware, with the user's consent — runs the
install, verifies, and continues the same session. When it can't (no rights or
package manager, or the user declines), it falls back to copy-paste manual
install, and failing that does the maximum file-only Chief of Staff setup while
clearly flagging what's deferred until Node and git exist.

## Problem Frame

The onboarding scripts (`guild-connect` and `claudecof-setup`) are zero-dependency
Node 18+ `.mjs` files run via `node`, and the durable-repo / guild-git steps need
git. Some new members arrive with neither installed.

Today that produces a silent downgrade, not a handled case. In the observed
session (the attached transcript), Claude saw "Node.js isn't installed," concluded
it couldn't run the guild scripts, and proceeded to scaffold the Chief of Staff by
hand with file operations only — never offering to install Node, and never
explaining what the user had lost (guild connect, git access, the portable repo).
The member ends up with a partial, half-explained setup and no path forward.

The root cause is a choreography gap, not a capability gap: Claude Code has shell
tools (Bash / PowerShell) and can run `winget install`, `xcode-select --install`,
etc. The skill never told it to try, so it gave up. The fix is mostly new
instructions in the onboarding choreography, not new scripts.

## Key Decisions

- **Agent installs, with consent, is the primary path.** The skill instructs the
  agent to detect the OS, propose the correct install command, ask permission,
  run it via the shell, verify, and continue in the same session — rather than
  only printing instructions and stopping. The transcript failure was Claude not
  *trying*; the remedy is choreography that makes trying the default.

- **The prerequisite gate runs at the shell, before any `.mjs`.** `doctor.mjs`
  cannot be the gate for a missing-Node machine because it is itself a Node
  script that can't start. A shell-level `node --version` / `git --version` check
  precedes `doctor.mjs` and owns the missing-prereq branch. `doctor.mjs` remains
  the deeper preflight once Node is present.

- **Three-rung fallback ladder; no machine state is a dead end.** Agent install
  (with consent) → guided manual install (copy-paste commands / official
  installer links, user installs, agent re-checks) → file-only degrade (scaffold
  the Chief of Staff now, flag deferred steps and how to resume). New users are
  never hard-gated to nothing.

- **Installs are consented, never silent.** Installing software is a
  system-modifying action. The agent shows the exact command, asks first, never
  elevates privileges silently, and respects a "no" — consistent with
  `guild-connect`'s existing security posture.

## Requirements

**Detection and gating**

- R1. Before running any `.mjs` in the onboarding choreography, the skill checks
  for Node 18+ and git at the shell level (`node --version`, `git --version`),
  not via `doctor.mjs`.
- R2. The check distinguishes the three states that matter: missing, present but
  too old (Node < 18), and present and adequate. A too-old Node is treated like
  missing for install purposes.
- R3. When both prerequisites are adequate, onboarding proceeds to `doctor.mjs`
  and the existing choreography unchanged — the new path adds no friction to the
  already-equipped user.

**Agent-driven install (primary)**

- R4. When a prerequisite is missing, the agent identifies the OS and proposes
  the OS-appropriate install for the missing tool(s), then asks the user's
  consent before running anything.
- R5. The proposed command is shown to the user in full before it runs; the
  agent never installs silently and never attempts privilege elevation without
  the user's explicit agreement.
- R6. After an install, the agent re-verifies the tool is present and adequate
  before continuing.

**Verification and PATH handling**

- R7. The agent handles the "installed but not yet visible on PATH in this
  shell" case (common on Windows after `winget`) by guiding the user to open a
  fresh shell / re-run onboarding, rather than retry-looping on a binary the
  current process can't see.
- R8. Verification has a bounded number of attempts; it does not loop
  indefinitely when a tool stays unavailable.

**Fallback ladder**

- R9. When agent install can't proceed — no package manager, no rights, the
  command fails, or the user declines — the skill falls back to guided manual
  install: copy-paste commands and/or official installer links for the user's
  OS, after which the user signals completion and the agent re-checks (R6–R7).
- R10. When the user still can't or won't install, onboarding degrades to a
  file-only Chief of Staff scaffold (the work that needs neither Node nor git)
  and continues rather than stopping.
- R11. The degrade clearly states what was deferred (guild connect, git access,
  the portable `repo/`) and how to resume: install Node + git, then re-run the
  onboarding one-liner — the idempotent choreography picks up the deferred steps.

**Where it lives**

- R12. The missing-prereq path lives primarily in `guild-connect`'s choreography
  (the onboarding spine). `claudecof-setup`'s preflight references the same gate
  so the Chief-of-Staff entry point behaves identically.
- R13. `docs/onboarding-prompt.md`'s "Requires Node 18+ and git" line is updated
  to reflect that the skill now helps install them rather than assuming they're
  present.

## Acceptance Examples

- AE1. **Covers R1, R4, R6.** Fresh Windows 11 machine, no Node, git present.
  Onboarding detects Node missing at the shell, proposes `winget` install for
  Node LTS, asks consent, runs it on yes, re-verifies, and continues to
  `doctor.mjs` and the connect flow.
- AE2. **Covers R7.** Same machine, install succeeds but `node` isn't on PATH in
  the current shell. The agent recognizes this, tells the user to open a new
  shell and re-run the onboarding line, and does not loop trying to invoke the
  invisible binary.
- AE3. **Covers R5, R9.** Locked-down corporate machine where `winget` install
  fails for lack of rights. The agent falls back to official-installer links /
  guided steps and waits for the user to install, then re-checks.
- AE4. **Covers R10, R11.** User declines to install Node entirely. The agent
  scaffolds the file-only Chief of Staff, states that guild connect, git access,
  and the portable repo are deferred, and tells the user exactly how to finish
  later.
- AE5. **Covers R2.** Machine has Node 16. The gate flags it as too old, treats
  it like missing, and offers to install Node 18+.

## Scope Boundaries

- Not rewriting the `.mjs` scripts to remove the Node dependency, and not
  bundling a Node runtime — the scripts stay Node; we make Node easy to get, not
  optional.
- Not building install support for non-Claude-Code assistants — the install
  guidance assumes Claude Code's shell tools. Other harnesses remain future work.
- Not owning package-manager bootstrap as a guarantee — if a platform has no
  usable package manager and no official-installer path the user can complete,
  the ladder lands on file-only degrade rather than promising a universal
  installer.

## Dependencies / Assumptions

- Assumes the agent harness exposes a shell it can run install commands through
  (Bash / PowerShell in Claude Code) and that the user can grant consent
  interactively.
- Assumes OS-native package managers as the default install mechanism where
  present (winget on Windows 11, the distro package manager on Linux, Xcode
  Command Line Tools / Homebrew-if-present on macOS), with official installers as
  the manual-fallback mechanism. Exact per-OS commands are an implementation
  detail for planning.
- Assumes the onboarding choreography stays idempotent and re-runnable, so the
  resume-after-install path (R11) needs no new state — it relies on the existing
  per-step done-state checks.

## Outstanding Questions

**Deferred to Planning**

- Exact per-OS install commands and the macOS git path (Xcode CLT vs Homebrew vs
  official `.pkg`), including whether to attempt a Homebrew bootstrap or prefer
  official installers when Homebrew is absent.
- Whether the shell-level gate is authored as inline choreography prose or as a
  tiny non-Node helper (e.g., a shell snippet) the agent runs — and how it
  reports the three states from R2.
- How many verification attempts (R8) and what exact re-shell guidance wording
  (R7) for each OS.
