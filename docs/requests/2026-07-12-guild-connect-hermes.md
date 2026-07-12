# Request: Make guild-connect standalone and portable to Hermes

*Drafted 2026-07-12. Source: "Fix the install skill" notes + scoping Q&A.*

## Goal

`guild-connect` becomes a self-contained, platform-portable skill: it authenticates a
member with AI Power Guild, verifies git + Node prerequisites, and **owns personal git
repository setup end-to-end** — with no choreography dependency on `claudecof-setup` —
and is **verified working in both Claude Code and Nous Research Hermes agents**.

## Budget

- **Wall clock:** ~half day (3–4 h), with a user checkpoint after Phase 2.
- **Tokens:** ≤ 800k total, allocated per phase below.
- **Stop rule:** if any phase exceeds its allocation by 50%, halt and report rather
  than borrowing from later phases.

## Phase 1 — Decouple from claudecof-setup (~1h / 150k tokens)

The scripts (`git-setup.mjs`, `repo-setup.mjs`) already live in guild-connect; the
remaining coupling is choreographic.

- Move the personal-repo setup into guild-connect's own choreography: after
  connect + git access, guild-connect offers and runs repo setup itself.
- Remove the Step 7 Chief-of-Staff handoff from `skills/guild-connect/SKILL.md`
  (currently ~line 204). `claudecof-setup` becomes a fully independent, run-anytime
  catalog skill (consistent with the U8/R13 bootstrap-vs-catalog split).
- Update `skills/claudecof-setup/SKILL.md` to *consume* an existing repo (degrade
  gracefully if absent) instead of orchestrating its creation.
- Update `docs/onboarding-prompt.md` and `CLAUDE.md`.

**Accept when:** `npm test` green; no choreography reference from guild-connect →
claudecof-setup; connect → doctor → git-setup → repo-setup completes standalone in a
fresh Claude Code session.

## Phase 2 — Hermes research spike (~1h / 150k tokens)

- Read `../botbox` (agent image definitions) and `../humanpower` (agent manager) to
  learn: where skills/instructions load in a Hermes agent, where credential files can
  live (`$AI_POWER_GUILD_CREDENTIALS_PATH` equivalent), whether Node ≥ 18 + git are in
  the image, and how agents are provisioned.
- Supplement with Nous Research Hermes docs/web research.
- **Deliverable:** `docs/hermes-compatibility.md` — recommended placement for the
  auth + repo components on Hermes, plus a gaps list (e.g. missing Node/git in image).

**⏸ Checkpoint: review findings with Andy before Phase 3.**

## Phase 3 — Adapt + test both platforms (~1.5–2h / 400k tokens)

- Apply the placement recommendation: installer/path changes, platform detection where
  needed. Constraints: scripts stay zero-dependency Node ≥ 18; security rules preserved
  (never print tokens, `Authorization` headers, or raw error bodies).
- **Test matrix:**

  | Flow | Claude Code | Hermes (already-running fly.io agent) |
  |---|---|---|
  | doctor (git + Node check) | ☐ | ☐ |
  | connect (send → verify → status) | ☐ | ☐ |
  | git-setup + repo-setup | ☐ | ☐ |

- Testing infrastructure: this machine has an SSH key that can build and run Hermes
  agents on fly.io; agent images are defined in `../botbox`; the managing application
  is `../humanpower`; Andy's account has one Hermes agent already running. Prefer the
  running agent; only build/deploy new botbox images if unavoidable (flag first — real
  infra cost).

**Reserve:** 100k tokens for fixes discovered during testing.

## Out of scope

- claudecof-setup's scaffold content/templates; guild-memory; new Hermes-only features
  beyond parity.
- Catalog repinning: after this lands, catalog entries pinned at commits will need a
  repin via the new `guild-catalog` skill — **flag as follow-up, don't do it here**.

## Risks

- Hermes image may lack Node 18/git → bounded response: document in gaps list, propose
  botbox change, don't rebuild the world.
- fly.io testing touches live infra — confirm before any deploy/provision action.
