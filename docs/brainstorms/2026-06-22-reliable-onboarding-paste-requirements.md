---
date: 2026-06-22
topic: reliable-onboarding-paste
---

# Reliable Onboarding via a Single Paste-able Instruction

## Summary

Give users one paste-able instruction (Claude Code first) that takes them from
zero to onboarded — connect → git-setup → repo-setup → scaffold — by running the
guild scripts directly, cloning them only if the skill isn't already available.
Install the guild skills into the Chief of Staff (COF) project as a
**project-scope skills-directory plugin** (no marketplace, no `claude plugin
install`), and ship the memory hooks **dormant** until latency testing clears
them. The marketplace plugin remains an optional auto-updating upgrade.

---

## Problem Frame

Users consistently fail to install the plugin. The root cause is structural:
plugin installation is a host/CLI operation, and people (or the in-session agent)
try to do it from inside a running Claude session, where it can't take and the
agent improvises. The published README now leads with terminal-first
instructions, but a terminal command is still not the "paste into your AI and
go" experience we want.

The unlock is that **onboarding does not need the plugin.** Connect, git-setup,
repo-setup, and scaffold are self-contained Node scripts — proven to run
standalone end-to-end. And ongoing skill access does not need the marketplace
either: Claude Code discovers skills from the filesystem (`.claude/skills/`), and
a project-scope skills-directory plugin loads skills (and, when declared, hooks)
with no marketplace and no install CLI — only a one-time workspace-trust prompt.
That lets a single paste do everything a paste *can* do, and pushes the
un-pasteable marketplace step off the critical path.

---

## Key Decisions

- **Decouple onboarding from plugin install ("onboarded is enough").** Success is
  account connected + COF scaffolded, done by running the scripts. The marketplace
  plugin is a follow-up, never a blocker.
- **Project-scope skills-directory plugin is the v1 distribution.** The guild
  skills install into the COF project's `.claude/skills/`, filesystem-only, no
  marketplace. Skills (and later, hooks) are confined to that project, which is
  exactly why hooks must NOT be global.
- **Memory hooks are distributed but dormant.** The hook scripts ship with the
  install, but no hook declaration is registered, so they never fire. Activation
  is an explicit step taken only after latency testing — and the same dormancy is
  enforced on the marketplace plugin, which currently ships the hooks active.
- **No auto-update in v1.** Auto-update requires a marketplace; v1 stays current
  via manual/command-driven `git pull` + reload. Marketplace `--scope project` is
  the documented opt-in upgrade for auto-update.
- **Claude Code first.** Cross-platform adaptation of the paste is later work.

---

## Requirements

### Paste-able onboarding (Claude Code, v1)

- R1. A single paste-able natural-language instruction takes a Claude Code user
  from zero to onboarded: connect → git-setup → repo-setup → scaffold.
- R2. The instruction prefers an already-available `guild-connect` skill; if it is
  absent, it clones `zingleton/skills` and follows
  `skills/guild-connect/SKILL.md`.
- R3. "Onboarded" means account connected and COF project scaffolded; it does not
  require a marketplace plugin install.
- R4. The instruction ends by pointing the user at the optional marketplace
  plugin (the auto-updating path) as a follow-up, not a prerequisite.

### Project-scope install of the guild skills

- R5. Onboarding installs the guild skills (`guild-connect`, `claudecof-setup`)
  into the COF project as a project-scope skills-directory plugin — available when
  working in that project, with no marketplace and no `claude plugin install`.
- R6. The two skill folders install as siblings so `claudecof-setup`'s
  `../guild-connect/scripts/` references keep resolving.
- R7. The install requires a one-time workspace-trust acceptance, and the project
  is launched from its root.

### Memory hooks — distributed, dormant

- R8. The memory hook scripts (recall/retain) are distributed with the install
  (present on disk) but not activated — no hook declaration is registered, so they
  do not fire.
- R9. Enabling the hooks is an explicit, documented step (ideally a guild command),
  taken only after latency testing.
- R10. When enabled, the memory hooks are project-scoped — they fire only in the
  COF project, never globally.
- R11. The marketplace plugin manifest, which currently declares the hooks active,
  is changed to ship them dormant too, so no distribution path fires them before
  latency testing clears them.

### Updates and marketplace migration

- R12. v1 keeps the project install current via manual/command-driven update
  (`git pull` of the source + reload); auto-update is not provided without a
  marketplace.
- R13. Adopting the marketplace plugin later is a documented clean migration:
  disable `ai-power-guild@skills-dir` (or delete the project folder) before
  `claude plugin install`, to avoid two active skill sets and double-firing hooks.

---

## Key Flows

- F1. First run via paste
  - **Trigger:** User pastes the instruction into Claude Code.
  - **Steps:** Use the `guild-connect` skill if present, else clone
    `zingleton/skills` → run the onboarding (doctor → connect → git-setup →
    repo-setup → scaffold) → install the guild skills into the COF project's
    `.claude/skills/` as a project-scope plugin with the memory hooks present but
    dormant → point the user at the optional marketplace upgrade.
  - **Outcome:** Connected account, scaffolded COF, guild skills available in the
    project, no hooks firing.
- F2. Enable memory hooks (after latency testing)
  - **Trigger:** Latency testing clears the hooks.
  - **Steps:** A documented/automated step registers the hook declaration
    (project-scoped) and reloads.
  - **Outcome:** Recall/retain hooks fire only in the COF project.
- F3. Migrate to the marketplace plugin (optional)
  - **Trigger:** User wants auto-update.
  - **Steps:** Disable `ai-power-guild@skills-dir` (or delete the folder) →
    `claude plugin install ai-power-guild@guild-skills` → `/reload-plugins`.
  - **Outcome:** One active plugin, auto-updating; no duplicate skills or hooks.

---

## Scope Boundaries

### Deferred for later

- Cross-platform adaptation of the paste-able instruction (ChatGPT, Cursor, etc.).
- The terminal one-liner installer (the inversion approach).
- An auto-update mechanism without a marketplace (e.g. a SessionStart self-update
  hook).
- Actually enabling the memory hooks — gated on latency testing (R9).

### Outside this phase's identity

- Requiring the marketplace plugin for onboarding. The marketplace is the
  auto-update upgrade, not the entry point.

---

## Dependencies / Assumptions

- Verified against current Claude Code docs: project `.claude/settings.json` hooks
  fire only in that project; a project-scope skills-directory plugin
  (`<project>/.claude/skills/<name>/.claude-plugin/plugin.json`) loads skills +
  hooks confined to the project after a workspace-trust prompt; auto-update
  requires a marketplace; same-named plugins from different sources (`@skills-dir`
  vs `@guild-skills`) load as distinct plugins with no auto-dedup, so hooks would
  double-fire if both are active.
- The onboarding scripts run standalone from a fresh clone (proven end-to-end on
  Windows in prior testing), and benefit from the file-path JSON-arg input that
  avoids the permission prompt.

---

## Outstanding Questions

### Resolve before / during planning

- **Exact packaging of the project install:** a skills-directory plugin manifest
  (`.claude-plugin/plugin.json`, gives the `@skills-dir` identity and a clean
  `claude plugin disable`) versus plain project config (`.claude/skills/` +
  `.claude/settings.json`). The manifest matches the "project-scope plugin"
  framing and the disable-based migration; confirm in planning.
- **v1 update mechanism:** manual `git pull` + reload versus a SessionStart
  self-update hook. Manual is the lighter default; the self-update hook is the
  no-marketplace auto-update option.

### Deferred

- **Latency testing of the memory hooks** — a separate task that gates R9.
- **Whether to ship guild commands** that automate "enable memory hooks" and the
  "migrate to marketplace" sequence, rather than leaving them to documentation.
