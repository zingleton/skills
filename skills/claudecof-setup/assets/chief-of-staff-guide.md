# Personal Chief of Staff — Getting Started Guide

Your project is already set up. This folder has a local `CLAUDE.md` config and
`Notes/`, plus a portable `repo/` (a clone of your personal repo) holding
`repo/memory/`, `repo/skills/`, and `repo/Tools/` — the durable layer that
travels with you across machines. This guide is the companion reference — how to
run it, extend it, and get unstuck. (Adapted from the original template by graiz:
https://gist.github.com/graiz/6daf6b7608d22498720df5932d9abc29)

## Run it

From this folder:

```bash
claude
```

If you don't have Claude Code yet: `npm install -g @anthropic-ai/claude-code`.

## First tasks to try

Start simple to learn the system:

```
"Help me organize my Downloads folder"
"Search for files modified in the last week"
"What should I focus on today?"
```

Build from there. Each day, add one more workflow.

## Customize further

Open `CLAUDE.md` and refine:
- Your **About me** (role, what you're great at vs. what you struggle with)
- Your **Key people to prioritize**
- Your **Calendar** priorities (deep-work blocks, family time, no-meeting windows)

The more specific these are, the better your chief of staff performs.

## How memory works (`repo/memory/`)

Memory is file-based and version-controlled: `repo/memory/MEMORY.md` is the index,
and each fact is its own small markdown file alongside it. Keep facts atomic — one
idea per file — so they're easy to update or remove. Anything written here travels
with your `repo/` across machines and AI assistants.

### repo/memory/MEMORY.md (the index)

```markdown
# Memory Index

- [Co-founder Sam](sam.md) — syncs daily, owns product
- [Calendar prefs](calendar.md) — deep work 9-11 AM, no meetings before 9
```

### repo/memory/sam.md (one fact per file)

```markdown
---
name: sam
description: co-founder, daily sync
---

Sam is my co-founder. We sync daily at 9:30. Protect that slot.
```

## MCP servers to consider

MCP (Model Context Protocol) servers let Claude connect to external systems.
Start with just email and calendar; add more as needed.

- **Email** — Gmail / Outlook (Microsoft Graph)
- **Calendar** — Google Calendar
- **Task management** — Notion, Todoist, Airtable
- **Browser** — Claude in Chrome extension

## Tips for success

- **Week 1 — Basics**: file organization, simple searches, daily "What's my focus?" check-ins.
- **Week 2 — Memory**: capture key facts in `repo/memory/` (one file each, indexed in `MEMORY.md`), let context accumulate.
- **Week 3 — First tool**: pick one 30-minute daily task, have Claude build a tool for it, iterate.
- **Month 2+ — Compound**: tools reference tools, memory makes Claude smarter, workflows go automatic.

**The #1 rule when overwhelmed:** ask "What's the ONE thing that matters today?"
Not 10 things. Not 5. ONE. Everything else is parking lot until that's handled.

## Troubleshooting

- **"Claude forgot something from yesterday"** — check whether memory was updated; say "Update memory with [fact]"; new facts become files in `repo/memory/` indexed in `MEMORY.md`.
- **"Claude created a tool that doesn't work"** — say "Can you fix this tool?" and show the error; iterate.
- **"I'm overwhelmed"** — say "Help me prioritize — what's the ONE thing?"; move the rest to parking lot.
- **"Claude is too verbose"** — reinforce the Communication Style rules in `CLAUDE.md`; ask for shorter responses.

## Going further

As you get comfortable, add **subagents** (specialized domains), **skills**
(multi-step workflows), **slash commands** (quick access), and **scheduled
automation**. But start simple — the basics save hours every week.

## Resources

- Claude Code docs: https://github.com/anthropics/claude-code
- MCP servers: https://github.com/modelcontextprotocol/servers

---

**Remember:** Start simple. Build daily. Compound progress beats heroic effort.
Pick ONE workflow to automate this week. Then come back and add another.
