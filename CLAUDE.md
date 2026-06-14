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
    tests/*.test.mjs         Unit tests (node --test) — run via `npm test`
  claudecof-setup/           Scaffolds a "Personal Chief of Staff" Claude Code project
    SKILL.md                 Setup workflow + guild-connect integration
    scripts/scaffold.mjs     Deterministic project writer (templates → project)
    assets/                  CLAUDE.md template, memory templates, getting-started guide
CLAUDE.md                    This file
package.json                 npm test → guild-connect unit tests
.gitignore
```

Skills may reuse each other: `claudecof-setup` calls `guild-connect`'s scripts
(`../guild-connect/scripts/`) to pre-fill a member's details, degrading
gracefully when the guild isn't connected.

## Working in this repo

- **Skills are the product.** Each skill is a directory under `skills/` with a
  `SKILL.md` and its supporting scripts.
- **Verify with `npm test`** (Node's built-in runner, zero dependencies). It
  runs the `guild-connect` unit tests — credential store/lock/refresh, the
  API 401/redaction discipline, and the pure helpers. Run it after touching any
  script under `skills/`.
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
