---
name: claudecof-setup
description: >
  Set up a "Personal Chief of Staff" - an executive-assistant AI that runs in
  Claude Code - by scaffolding a project with a customized CLAUDE.md, a memory
  store, Tools/ and Notes/ folders, and a getting-started guide. When the
  member's AI Power Guild account is connected, pre-fills their name, role,
  links, and interests so the config starts personalized instead of blank. Use
  this whenever someone wants to create, configure, bootstrap, or "set up" a
  personal chief of staff, a "COF", an executive assistant, a daily-driver
  productivity assistant, or a personal-assistant Claude project, including
  phrasings like "set up my chief of staff", "make a Claude that runs my day",
  "configure claudecof", "build me an executive assistant in Claude Code", or
  "I want a personal assistant project", even if they never name the template.
---

# claudecof-setup

Builds a ready-to-run **Personal Chief of Staff** project: an executive-admin
assistant the member opens with `claude` in its own folder. The config is based
on graiz's Chief of Staff template, customized to the member, and seeded with a
memory store so the assistant remembers context across sessions.

The win is a config that starts **personalized**: when the member's AI Power
Guild account is connected, their name, role, links, and interests flow
straight into the `CLAUDE.md` "About me" so they aren't filling in a blank
template.

## What it creates

```
<project>/
├── CLAUDE.md                       # the assistant's config (customized)
├── memory/
│   ├── memory.md                   # quick reference (people, IDs, prefs)
│   ├── context.txt                 # current state (projects, focus)
│   └── conversations/              # daily session logs (starts empty)
├── Tools/                          # scripts the assistant builds over time
└── Notes/
    └── chief-of-staff-guide.md     # how to run, extend, and troubleshoot it
```

The long template and the project writing are handled by `scripts/scaffold.mjs`
so every run is byte-identical — your job is the conversational part: gathering
and **confirming** the customization values, then calling the script once.

## Workflow

### 1. Pick the project location

Ask where to create it. Default to `PersonalChiefOfStaff` in the current
directory if the member has no preference. If a `CLAUDE.md` already exists
there, stop and confirm before overwriting (the scaffold refuses without
`force: true` — surface that, don't blindly force).

### 2. Pull AI Power Guild data (when available)

The `guild-connect` skill is a sibling in this same plugin; its scripts live at
`../guild-connect/scripts/` relative to THIS skill's directory. They need
Node 18+. If that folder isn't present or Node isn't available, skip this whole
step and gather everything by interview instead — guild data is a nice-to-have,
never a requirement.

When it is present:

1. **Check the connection** (never prompts):
   `node ../guild-connect/scripts/connect.mjs status`
   - `connected` → continue.
   - `not_connected` / `reconnect_required` → tell the member they can connect
     their guild account to auto-fill their details, and if they want to, run
     the `guild-connect` connect flow (`send` → `verify`) first. If they'd
     rather not, proceed by interview.
2. **Read their data** (each prints JSON on stdout, an `Acting as <email>`
   banner on stderr):
   - `node ../guild-connect/scripts/profile.mjs get` → `{ok, profile}`. The
     public profile: `display_name`, `website_url`, `linkedin_url`,
     `youtube_url`, `description`. `profile: null` means nothing saved yet —
     a state, not an error.
   - `node ../guild-connect/scripts/interests.mjs get` → `{ok, intake}`:
     `role_key`, `deliverable_interests`, `task_interests`, `pain_point`,
     `email_cadence`. `intake: null` means they haven't done the intake.
   - `node ../guild-connect/scripts/intake.mjs options` → the catalog used to
     turn ids into human labels: `roles[{key,label}]`,
     `deliverable_types[{id,label}]`, `tasks[{id,label}]`.

### 3. Map guild data → config (then confirm with the member)

Resolve labels from the catalog, then draft the `CLAUDE.md` fields:

| Config field | Source |
| --- | --- |
| `name` | `profile.display_name` (ask if null) |
| `aboutMe` | compose from the **role label** (`roles[key==role_key].label`), `profile.description`, the member's **interested** deliverables/tasks (their focus areas), and `pain_point` (what they struggle with) |
| `email` (memory) | the `Acting as` email from the banner, or `profile`/ask |
| `links` (memory) | `website_url` / `linkedin_url` / `youtube_url` |
| `keyPeople` | **not in guild — ask the member** |
| `calendarPriorities` | **not in guild — ask the member** |

For interests, map only the entries with `interested: true` to their labels;
present focus areas in the catalog's order, and don't read meaning into the
array order (it's id-ordered, not ranked).

**Confirm before writing.** Show the member the drafted "About me", key people,
and calendar priorities and get their OK — this is their identity going into a
file they'll live with. Treat guild data as a *draft to approve*, mirroring how
`guild-connect` itself never saves a value the member hasn't approved. Fill any
gaps (key people, calendar) by asking; leave a field to its template default
rather than inventing personal facts.

### 4. Scaffold the project

Call the script once with the confirmed values:

```
node scripts/scaffold.mjs '{
  "targetDir": "<path>",
  "name": "Ada Lovelace",
  "aboutMe": "I'm a founder at an early-stage AI startup. Strong at ideation; I want help protecting focus for execution. Focus areas: investor updates, product specs. I struggle with saying no to meetings.",
  "keyPeople": "- Co-founder Sam - sync daily\n- Partner - protect evenings",
  "calendarPriorities": "- Protect deep work blocks 9-11 AM\n- Family time = HIGH priority",
  "email": "ada@example.com",
  "links": [{"label": "Website", "url": "https://ada.dev"}, {"label": "LinkedIn", "url": "https://linkedin.com/in/ada"}]
}'
```

Everything except `targetDir` is optional — omitted fields keep the template's
own guidance text, so the file is still usable. Pass `"force": true` only after
the member confirms overwriting an existing `CLAUDE.md`. The script seeds memory
files only when absent, so a forced refresh of `CLAUDE.md` never wipes
accumulated memory.

### 5. Hand off

Report what was created and tell the member how to start their assistant:

```
cd "<project>" && claude
```

Point them at `Notes/chief-of-staff-guide.md` for first tasks, MCP server
ideas (email/calendar), and troubleshooting. Suggest they automate ONE workflow
this week.

## Hard rules

- **Never overwrite a customized `CLAUDE.md` without explicit confirmation.** A
  chief of staff config accretes value; treat it like the member's own
  document.
- **Guild data is a draft, not a done deal.** Show it, get approval, then write.
  Don't invent personal facts (key people, calendar habits) the member didn't
  give you — leave the template default instead.
- **Guild integration is optional.** Missing `guild-connect`, no Node, an
  unconnected account, or `null` profile/intake are all normal — fall back to a
  short interview. Never block the setup on the guild.
- **Don't print tokens or raw guild error bodies.** Quote only the guild
  scripts' own JSON/stderr output, exactly as `guild-connect` requires.
