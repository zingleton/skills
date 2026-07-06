# AI Power Guild — Agent Skills Plugin

## Mission

This repository is a **Claude Code plugin** that packages **agent skills** for the
**AI Power Guild** app. The skills let a member act on their own guild account from
inside their AI environment — connecting the account, running the AI-led intake
interview, and managing their public profile and photo — by calling the guild
website's `/api/*` routes with a Bearer token (never the database directly).

The goal is to grow this plugin with additional guild skills over time. New skills
reuse the shared connect/credential plumbing established by `guild-connect`
(`scripts/credentials.mjs` + `scripts/api.mjs`).

## The AI Power Guild app

The skills target the guild web app, which lives in a sibling checkout next to this
repo (the path differs per machine):

- `../aisupply` — app source on this machine, **or**
- `../humanpower` — app source on other machines

Deployed at **https://pg.singleton.ai**.

The app is a Next.js + Supabase project that exposes the server-side `/api/*`
routes the skills call, plus `llms.txt` documentation describing them. **The
skills live here, in this repository — this is their single source of truth.**
The app no longer carries a `skills/` copy. When a skill's API contract is
unclear, read the app's route handlers and its `llms.txt` rather than guessing.

## Repository layout

```
.claude-plugin/plugin.json   Plugin manifest (name, version, author)
.claude-plugin/marketplace.json  Marketplace "guild-skills" — makes the repo installable
skills/
  guild-connect/             Connect + onboarding skill (intake + profile + avatar)
    SKILL.md                 Skill instructions and contract
    scripts/*.mjs            Zero-dependency Node 18+ scripts (machine-readable JSON on stdout)
      install-skills.mjs     Copies the guild skills → ~/.claude/skills/ (user-scope install + update path)
    tests/*.test.mjs         Unit tests (node --test) — run via `npm test`
  claudecof-setup/           Scaffolds a "Personal Chief of Staff" Claude Code project
    SKILL.md                 Setup workflow + guild-connect integration
    scripts/scaffold.mjs     Deterministic project writer (templates → project)
    assets/                  CLAUDE.md template, memory templates, getting-started guide
  guild-memory/              Opt-in portable memory (Hindsight) — off until activated per project
    SKILL.md                 Setup / activate / manage memory
    scripts/*.mjs            Memory scripts (import guild-connect's credentials.mjs/api.mjs as siblings)
      memory-activate.mjs    Writes the capture hooks into a target project's .claude/settings.json
    tests/*.test.mjs         Unit tests
  guild-skills/              Skills-catalog installer (skills-delivery U5-U7)
    SKILL.md                 Browse / install / update / uninstall / promote / harvest
    scripts/*.mjs            catalog, install, uninstall, promote, status, update, harvest +
                             shared scopes/lockfile/fetch-skill (imports guild-connect api/creds)
    tests/*.test.mjs         Unit tests (node --test)
docs/onboarding-prompt.md    The single paste-able onboarding instruction (user-scope install)
CLAUDE.md                    This file
package.json                 npm test → unit tests for all skills
.gitignore
```

Skills may reuse each other: `claudecof-setup` calls `guild-connect`'s scripts
(`../guild-connect/scripts/`) to pre-fill a member's details, degrading
gracefully when the guild isn't connected. `guild-memory` and `guild-skills`
import `guild-connect`'s `credentials.mjs` / `api.mjs` via
`../../guild-connect/scripts/`.

**Bootstrap vs. catalog (skills-delivery U8, R13).** The marketplace plugin and
the in-session `install-skills.mjs` now bootstrap only two skills:
`guild-connect` (connect/credentials) and `guild-skills` (the catalog
installer). The **Chief of Staff setup** (`claudecof-setup`) and **portable
memory** (`guild-memory`) are no longer auto-installed — they ship as
**catalog entries** and are installed on demand with `guild-skills install`.
Their skill folders stay in this repo because the catalog pins point at them
(`zingleton/skills` @ a curator-evaluated commit). Create/curate those catalog
entries through the app's `POST /api/skills-catalog/manage` API with a
guide/admin credential (see `docs/skills-catalog-migration.md`).

**Onboarding offers two equal install paths.** The paste-able instruction
(`docs/onboarding-prompt.md`) runs onboarding from the skill's choreography, then
at the end offers two equal ways to make the skills durable: **in-session**
`install-skills.mjs` (copies `guild-connect`, `claudecof-setup`, `guild-memory`
into `~/.claude/skills/`; re-run to update), or the **terminal** marketplace
plugin (`claude plugin marketplace add zingleton/skills` →
`claude plugin install ai-power-guild@guild-skills`; cleanest ongoing
permissions). The in-session installer can trip a self-modifying-config
permission guardrail, which the terminal path avoids (see the welcome-page note
in `docs/aisupply-welcome-page-onboarding-note.md`). **Memory is opt-in:** the
plugin no longer auto-loads memory hooks (v0.4.0); a member turns memory on for
one project via `guild-memory`'s `memory-activate.mjs`.

## Working in this repo

- **Skills are the product.** Each skill is a directory under `skills/` with a
  `SKILL.md` and its supporting scripts.
- **Verify with `npm test`** (Node's built-in runner, zero dependencies). It
  runs the unit tests for both skills (glob `skills/**/tests/**/*.test.mjs`) —
  `guild-connect`'s credential store/lock/refresh, API 401/redaction, the
  `doctor`/`repo-setup` pure helpers and orchestrators, and `claudecof-setup`'s
  scaffold + skills-linking. Run it after touching any script under `skills/`.
- **`guild-connect` is canonical and shared.** It owns the credential file contract
  (`$AI_POWER_GUILD_CREDENTIALS_PATH` → `~/.config/ai-power-guild/credentials.json`,
  file `0600`). Future skills import its `credentials.mjs` / `api.mjs` instead of
  re-implementing auth or token handling.
- **This repository is the single source of truth for the skills.** They used to
  be mirrored in the app repo (`../aisupply/skills/`); that copy is being removed.
  Develop skills here and publish them via the marketplace. When the app's `/api`
  contract changes, update the skills here to match — there is no second copy.
- **Security rules carry over from `guild-connect/SKILL.md`:** never print tokens,
  `Authorization` headers, or raw error bodies; never export tokens to env vars or
  copy the credential file; surface the `Acting as <email>` banner each session.

## Authoring new skills — skill-creator

Use Anthropic's **skill-creator** skill (`anthropic-skills:skill-creator`, available
in this environment) to scaffold, edit, evaluate, and optimize skills. Invoke it via
the Skill tool when creating a new guild skill or refining an existing one. It is the
preferred tool over hand-writing `SKILL.md` from scratch.
