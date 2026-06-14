# AI Power Guild — Claude Code Plugin

Agent skills that connect Claude Code to the [AI Power Guild](https://pg.singleton.ai)
app and help members get set up. The plugin bundles:

- **`guild-connect`** — connect this environment to your guild account and run
  AI-led onboarding (intake interview, public profile, photo).
- **`claudecof-setup`** — scaffold a personalized "Personal Chief of Staff"
  project (a customized `CLAUDE.md` + memory system), pre-filled from your guild
  profile when it's connected.

## Install

Requires [Claude Code](https://code.claude.com) v2.1+ and Node 18+.

```bash
claude plugin marketplace add zingleton/skills
claude plugin install ai-power-guild@guild-skills
```

Then connect your account (launches an interactive session):

```bash
claude "Connect my AI Power Guild account and walk me through setting it up."
```

Or do it all in one line:

```bash
claude plugin marketplace add zingleton/skills && claude plugin install ai-power-guild@guild-skills && claude "Connect my AI Power Guild account and walk me through setting it up."
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

## Updating

After new versions are published:

```bash
claude plugin marketplace update guild-skills
claude plugin update ai-power-guild@guild-skills
```

## Development

The skills are zero-dependency Node 18+ scripts. Run the unit tests with:

```bash
npm test
```

See [CLAUDE.md](CLAUDE.md) for the repo layout and contributor notes, and
[skills/guild-connect/README.md](skills/guild-connect/README.md) for the shared
credential contract.
