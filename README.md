# AI Power Guild — Claude Code Plugin

Agent skills that connect Claude Code to the [AI Power Guild](https://pg.singleton.ai)
app and help members get set up. The plugin bundles:

- **`guild-connect`** — connect this environment to your guild account and run
  AI-led onboarding (intake interview, public profile, photo).
- **`claudecof-setup`** — scaffold a personalized "Personal Chief of Staff"
  project (a customized `CLAUDE.md` + memory system), pre-filled from your guild
  profile when it's connected.
- **`guild-memory`** — opt-in portable memory (backed by the Guild's Hindsight
  server). Off until you activate it for a chosen project; onboarding never turns
  it on.

## Getting set up — two equal paths

Pick whichever fits. Both end in the same place (connected account → intake +
profile → git → optional Personal Chief of Staff). Requires
[Claude Code](https://code.claude.com), **Node 18+, and git** on your PATH.

- **Option A — paste an AI prompt** (no terminal): set up right now, inside a
  Claude Code session. The skills run from a clone for that session.
- **Option B — install the plugin** (one terminal step): the skills are
  installed permanently for every future session, with the fewest prompts.

You can start with A today and run B later to make it stick.

## Option A — Paste an AI prompt (no terminal)

**Paste one sentence** into a fresh Claude Code session (swap in your guild
email):

> **Onboard me to the AI Power Guild using the guild-connect skill from
> https://github.com/zingleton/skills — my guild email is you@example.com.**

It onboards you end-to-end. The steps live in the skill itself
([guild-connect's SKILL.md](skills/guild-connect/SKILL.md), the Choreography
section); see [docs/onboarding-prompt.md](docs/onboarding-prompt.md) for what
happens. To keep the skills for future sessions without a clone, onboarding ends
by offering either the user-scope installer (`install-skills.mjs`, re-run to
update) or Option B below.

## Option B — Install the plugin (terminal, durable)

> **Install the plugin from your terminal — not from inside a Claude Code
> session, and don't ask Claude to install it for you.** Plugin installation is
> a host operation: a running assistant can't reload itself mid-session, so when
> you ask it to install the plugin it looks like "nothing happened" and it tends
> to improvise. Run the three commands below yourself, *then* start Claude. This
> is the most common reason install "doesn't take."

Requires [Claude Code](https://code.claude.com) v2.1+, **Node 18+, and git** on
your PATH. Install Node first if you don't have it — the setup's preflight is a
Node script and can't run without it.

```bash
claude plugin marketplace add zingleton/skills
claude plugin install ai-power-guild@guild-skills
claude plugin list
```

The `@guild-skills` suffix is required — it tells Claude which marketplace to
install from. `claude plugin list` should show `ai-power-guild@guild-skills`
as **enabled**.

**Prefer a menu?** Inside Claude Code, run `/plugin`, add the `zingleton/skills`
marketplace, install **ai-power-guild**, then run `/reload-plugins`. If you
installed from the terminal while a session was already open, run
`/reload-plugins` (or restart `claude`) so the skills and hooks load.

### If the plugin won't install

- **"plugin not found in any marketplace"** — the catalog is stale. Refresh it,
  then reinstall:
  ```bash
  claude plugin marketplace update guild-skills
  claude plugin install ai-power-guild@guild-skills
  ```
- **Installed but the skills don't show up** — confirm it's enabled
  (`claude plugin list`); if not:
  ```bash
  claude plugin enable ai-power-guild@guild-skills
  ```
  then `/reload-plugins` in your session.
- **Still stuck?** Don't have the running Claude session install it — that's the
  trap. Run the terminal commands above; if a command errors, fix that error
  rather than scripting around it.

Once it shows **enabled**, connect your account (launches an interactive
session):

```bash
claude "Connect my AI Power Guild account and walk me through setting it up."
```

> New to the guild? Account creation happens on the web at
> [pg.singleton.ai/signup](https://pg.singleton.ai/signup) — the connect flow
> sends you there if no account exists for your email, then links it once you're
> signed up. The terminal never creates accounts by design.

## Using it

Once installed, just ask Claude in natural language:

- **Connect / onboard:** *"Connect my AI Power Guild account and run the intake."*
- **Edit your profile:** *"Update my guild profile description and links."*
- **Browse the catalog:** *"Show me the guild roles and tasks I can pick from."*
- **Set up a Chief of Staff:** *"Set up a Personal Chief of Staff for me in
  Claude Code, and pre-fill it from my AI Power Guild account."*
- **Turn on memory (opt-in):** *"Activate guild memory for this project."* Memory
  is the separate `guild-memory` skill — per-project and off until you ask.

## Updating

**Option A (user-scope install):** re-run the installer to refresh the
user-scope skills — no marketplace needed:

```bash
node skills/guild-connect/scripts/install-skills.mjs
```

(Run it from a `zingleton/skills` checkout, or just re-paste the onboarding
instruction.)

**Option B (marketplace plugin):** if you installed the plugin, refresh
the catalog **then** the plugin — at the terminal. The first command updates the
marketplace listing; the second installs the new version, so running only the
second won't pick up a release. Then `/reload-plugins` in any open session (or
restart `claude`):

```bash
claude plugin marketplace update guild-skills
claude plugin update ai-power-guild@guild-skills
```

If a connect step ever reports an outdated skill (`stale_skill`), the plugin is
behind the server — run the two commands above to update it.

## Development

The skills are zero-dependency Node 18+ scripts. Run the unit tests with:

```bash
npm test
```

See [CLAUDE.md](CLAUDE.md) for the repo layout and contributor notes, and
[skills/guild-connect/README.md](skills/guild-connect/README.md) for the shared
credential contract.
