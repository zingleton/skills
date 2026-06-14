# Personal Chief of Staff — Getting Started Guide

Your project is already set up: this folder has a `CLAUDE.md` config, a
`memory/` store, `Tools/`, and `Notes/`. This guide is the companion reference —
how to run it, extend it, and get unstuck. (Adapted from the original template
by graiz: https://gist.github.com/graiz/6daf6b7608d22498720df5932d9abc29)

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

## Example memory files

### memory/memory.md

```markdown
# Quick Reference

## Key People
- Name: email@example.com | Phone: xxx-xxx-xxxx | Notes: Co-founder
- Name: email@example.com | Relationship: Partner

## Important IDs
- Calendar ID: primary
- Email: yourname@gmail.com

## Preferences
- Best meeting times: 2-4 PM
- No meetings before 9 AM
- Deep work blocks: 9-11 AM daily
```

### memory/context.txt

```markdown
# Current Context - [Date]

## Active Projects
- Project 1: Status and next steps

## Open Loops
- Follow up with Person about Topic

## This Week's Focus
THE ONE THING: [What matters most this week]
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
- **Week 2 — Memory**: log sessions, build `memory.md` with key info, let context accumulate.
- **Week 3 — First tool**: pick one 30-minute daily task, have Claude build a tool for it, iterate.
- **Month 2+ — Compound**: tools reference tools, memory makes Claude smarter, workflows go automatic.

**The #1 rule when overwhelmed:** ask "What's the ONE thing that matters today?"
Not 10 things. Not 5. ONE. Everything else is parking lot until that's handled.

## Troubleshooting

- **"Claude forgot something from yesterday"** — check whether memory was updated; say "Update memory with [fact]"; log sessions to `memory/conversations/`.
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
