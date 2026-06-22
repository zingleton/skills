# Paste-to-onboard

The fastest way to join the AI Power Guild from Claude Code: **paste the block
below as your first message** to a Claude Code session. It onboards you
end-to-end and installs the guild skills at **user scope** (`~/.claude/skills/`)
so they're available in every future session — no marketplace, no
`claude plugin install`.

Requires [Claude Code](https://code.claude.com), **Node 18+**, and **git** on
your PATH. (Claude Code first; other assistants are future work.)

---

```text
Onboard me to the AI Power Guild, end-to-end.

1. Find the skills. If you already have the `guild-connect` skill available, use
   it from where it's installed. Otherwise clone the repo and work from the
   clone:
     git clone https://github.com/zingleton/skills
   and use the scripts under skills/guild-connect/scripts/ and
   skills/claudecof-setup/.

2. Run the guild onboarding in order (guild-connect describes each step):
   - doctor.mjs — preflight for Node 18+ and git. If it fails, show me the
     fixes and stop.
   - Connect my account: connect.mjs status; if I'm not connected, run the
     send/verify flow (ask me for my guild email, then the 6-digit code from the
     newest email). If I have no account yet, give me the pre-filled signup link.
   - Read my state and run the intake interview if I haven't done it, otherwise
     edit mode. Then the profile interview (name, links, description), asking
     per-source consent before drafting anything, and an optional photo.
   - git-setup.mjs to install my durable git credential.
   - Offer to set up a Personal Chief of Staff (the claudecof-setup skill):
     clone my personal repo via repo-setup.mjs and scaffold a personalized
     CLAUDE.md seeded from my profile. Skip if I decline.

3. Make the skills available everywhere. Run:
     node skills/guild-connect/scripts/install-skills.mjs
   This copies guild-connect, claudecof-setup, and guild-memory into
   ~/.claude/skills/ (user scope). Re-running it later is how I update them.

4. When you're done, tell me:
   - the guild skills are now installed at user scope — available in every
     session, with no marketplace required;
   - the optional `ai-power-guild` marketplace plugin exists as a follow-up if I
     ever want it, but it is not a prerequisite;
   - memory is available later through the `guild-memory` skill — opt-in,
     per-project, and OFF until I deliberately activate it.

Do not activate memory as part of onboarding. Surface the "Acting as <email>"
banner so I know which account is live, and never print tokens or raw error
bodies.
```

---

## What it does

- **Connects** this environment to your guild account (one connect per machine).
- **Interviews** you for the guild intake (role, deliverables, tasks, email
  cadence) and your public profile (name, links, description, photo).
- **Sets up git** access and, if you want it, a **Personal Chief of Staff**
  project seeded from your profile.
- **Installs the skills at user scope** so they load in every future Claude Code
  session. Re-run `install-skills.mjs` any time to update them.

## What it does *not* do

- It does **not** install the marketplace plugin (that's an optional follow-up).
- It does **not** turn on memory. Memory lives in the separate **`guild-memory`**
  skill and is opt-in, per-project, and off until you activate it for a chosen
  project — see that skill for `memory-setup` / `memory-activate`.
