# Note for the aisupply developer — Claude Code onboarding on the welcome page

Please offer **two equal ways** for a member to onboard to the guild from Claude
Code. They lead to the same place (connected account → intake + profile → git →
optional Personal Chief of Staff). Present them side by side; let the member pick.

**Prereqs to state once on the page:** [Claude Code](https://code.claude.com),
**Node 18+**, and **git** installed.

---

## Option A — Paste an AI prompt (no terminal)

> Best for getting set up right now, inside Claude Code.

Show this as a copy button. The member starts a Claude Code session in any folder
and pastes it as the first message:

```
Onboard me to the AI Power Guild using the guild-connect skill from https://github.com/zingleton/skills — my guild email is YOUR_EMAIL_HERE.
```

- **Pre-fill the email server-side.** The welcome page knows who's logged in, so
  template the member's actual email in place of `YOUR_EMAIL_HERE` before
  rendering the copy block — one less thing for them to edit.
- **What it does:** connects their account, runs the intake + profile interviews,
  sets up git access, and offers a Personal Chief of Staff. For this first
  session the skills run from a temporary clone of the repo.
- The member will be asked to approve a few actions (running scripts, the account
  connection) — that's expected.

---

## Option B — Run a terminal command (durable install)

> Best for installing the guild skills permanently, with the fewest prompts.

Show this as a copy button. **Tell the member to run it in a terminal — NOT inside
a running Claude Code session** (plugin install is a host operation and won't take
effect mid-session):

```
claude plugin marketplace add zingleton/skills
claude plugin install ai-power-guild@guild-skills
```

Then they start Claude Code and say, in natural language:

```
Connect my AI Power Guild account and onboard me.
```

- **What it does:** installs the guild skills (`guild-connect`,
  `claudecof-setup`, `guild-memory`) as a plugin available in **every** future
  session. Update later with `claude plugin update ai-power-guild@guild-skills`.
- Memory stays **off** — it's the opt-in `guild-memory` skill, activated per
  project only when the member asks.

---

## Why both

- **Option A** does all the onboarding work without a terminal, but the skills
  are only installed for that session (run from a clone).
- **Option B** is one terminal step up front, after which the skills are
  permanently available with cleaner permissions.

Either is fine; a member can start with A today and run B later to make it stick.

Repo (source of truth for both): https://github.com/zingleton/skills
