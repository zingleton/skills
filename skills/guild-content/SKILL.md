---
name: guild-content
description: >
  Find, post, edit, and retract AI Power Guild content (news and reviews) as a
  guide or admin, through the guild's content-management API. Use when a guide
  says things like "post this to the guild", "publish a review", "list my guild
  posts", "edit my post", or "retract that post". Builds on guild-connect for
  the account credential. Members without the guide role get a polite 403.
---

# guild-content

Publishes and manages first-party guild content — the news and review items
members see on `/news` and in digest emails — through
`/api/content/manage[/id]` (documented in the app's `llms.txt`). Guide/admin
only. Requires a connected account — run `guild-connect`'s `connect` first if
needed.

All scripts live in `scripts/` (zero dependencies — plain Node 18+). Run them
with `node`. **Stdout is machine-readable JSON; human/status copy and the
`Acting as <email>` banner go to stderr.** Do the drafting and selection
conversationally in chat, then pass finished arguments — the scripts never
prompt.

## Workflow

1. **Draft in chat.** Agree on title (≤200 chars), body (≤5000), an optional
   http(s) link, and an optional kind (`release` / `discussion` / `story`).
2. **Resolve tags.** Every post needs at least one interest tag. Fetch the
   public catalog with `guild-connect`'s `intake.mjs options` (or
   `GET /api/intake-options`), match the member-facing labels the guide used
   to `role_key` / `task_id` / `deliverable_type_id` values, and confirm the
   mapping in chat.
3. **Confirm, then post.** Posts publish IMMEDIATELY — there is no draft or
   approval step, and the item can reach every digest subscriber. Show the
   guide the exact title, body, link, kind, and tag labels and get an explicit
   yes. Then run `node scripts/post.mjs <payload.json> --confirm`. The
   `--confirm` flag asserts that a human approved this exact payload — never
   pass it without having asked.
4. **Find and read.** `list.mjs` (filters: `--status=published|retracted`,
   `--mine`, `--limit=N`) and `get.mjs --id=<uuid>` show what's live,
   including each item's `updatedAt` (needed for edits).
5. **Edit read-merge-write.** Run `get.mjs` first, merge the changes, then
   `edit.mjs --id=<uuid> <patch.json>` where the patch carries only the fields
   that change PLUS the item's current `updatedAt`. A `409
   stale_precondition` means someone else edited it — re-read, re-merge,
   retry. The script refuses a patch without `updatedAt`.
6. **Retract with care.** Retraction is PERMANENT in v1 (no restore). Echo the
   item's title and id to the guide, get an explicit yes, then
   `node scripts/retract.mjs --id=<uuid> --confirm`. The response echoes a
   snapshot of what was retracted — show it to the guide.

## Commands

- `list.mjs [--status=published|retracted] [--mine] [--limit=N]` — list
  first-party items, newest first. Connect-first.
- `get.mjs --id=<uuid>` — one item with tags and `updatedAt`.
- `post.mjs <payload.json|-|'{...}'> --confirm` — create and publish. Payload:
  `{"title","body","link","kind","tags":[{"role_key"| "task_id"|
  "deliverable_type_id"}]}` (link/kind optional). JSON can be a file path,
  `-` for stdin, or inline.
- `edit.mjs --id=<uuid> <patch.json|-|'{...}'>` — partial edit; the patch MUST
  include the item's current `updatedAt`.
- `retract.mjs --id=<uuid> --confirm` — permanently retract; prints the
  retracted snapshot.

## Rules

- **Human confirmation is not optional.** `post.mjs` and `retract.mjs` refuse
  to run without `--confirm`; pass it only after the guide approved the exact
  payload/item in chat.
- **Check before retrying.** After a timeout on `post.mjs`, do NOT re-run it
  blind: run `list.mjs --mine` first — if the post landed, use its id. The
  server's duplicate-title 409 (which returns `existing.id`) is the backstop,
  not the primary defense.
- **Surface API errors verbatim, and only them.** Print the returned `{error}`
  copy; the scripts already strip everything else.
- **Security (inherited from guild-connect):** never print tokens,
  `Authorization` headers, or raw error bodies; never export tokens to env
  vars; surface the `Acting as <email>` banner each session.
