# Onboard to the AI Power Guild — one line

Paste this into a Claude Code session (swap in your guild email):

> **Onboard me to the AI Power Guild using the guild-connect skill from
> https://github.com/zingleton/skills — my guild email is you@example.com.**

That's the whole prompt. The detailed steps live in the skill itself
([skills/guild-connect/SKILL.md](../skills/guild-connect/SKILL.md), the
**Choreography** section) — this file is just the invocation.

## What happens

- **If `guild-connect` is already installed** (you've onboarded before, or
  installed the plugin), the sentence triggers the skill and it runs its
  onboarding choreography, using the email you gave it.
- **If it isn't installed yet** (first time on this machine), Claude clones
  `https://github.com/zingleton/skills` and follows
  `skills/guild-connect/SKILL.md` from the clone — the skills run from that clone
  for this session.

At the end, onboarding offers **two equal ways** to keep the skills for future
sessions:

- **In-session:** run `install-skills.mjs`, which installs `guild-connect`,
  `claudecof-setup`, and `guild-memory` into `~/.claude/skills/` (re-run to
  update). May need a one-time permission grant.
- **Terminal (durable):** paste into a terminal — **not** a running session —
  `claude plugin marketplace add zingleton/skills` then
  `claude plugin install ai-power-guild@guild-skills`. Cleanest ongoing
  permissions.

End state: a connected account, your intake + public profile filled in, git
access, and (if you want it) a Personal Chief of Staff project seeded from your
profile. Memory stays **off** — it's the opt-in `guild-memory` skill, activated
per project only when you ask.

Requires [Claude Code](https://code.claude.com), **Node 18+**, and **git** on
your PATH. (Claude Code first; other assistants are future work.)
