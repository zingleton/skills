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

Needs [Claude Code](https://code.claude.com). **Node 18+** and **git** are also
required, but you don't have to install them yourself first — if either is
missing, the skill checks for it up front and offers to install it for you (with
your OK), so a fresh machine isn't a dead end. (Claude Code first; other
assistants are future work.)

One bootstrap wrinkle: if this is your **first run** and you don't have the plugin
installed yet, Claude fetches the skill by `git clone` — which needs git. So if
git is missing on a first run, Claude installs git first (with your OK), then
clones and continues. A missing Node on first run is fine — cloning needs git, not
Node, and the skill installs Node before it runs any scripts.
