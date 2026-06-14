---
name: guild-connect
description: >
  Connect this AI environment to the member's AI Power Guild account and run
  the guild's AI-led onboarding: the intake interview (role, deliverables,
  tasks, email cadence) and the profile interview (name, links, description,
  photo). Use when the member says things like "connect my guild account",
  "connect to the AI Power Guild", "set up my guild profile", "run the guild
  intake", "update my guild interests", or "change my guild profile photo".
  Also the shared connect/refresh plumbing every other guild skill reuses.
---

# guild-connect

Acts on the member's AI Power Guild account from their own AI environment.
One `connect` per environment; afterwards every guild skill shares the same
credential. All data access goes through the guild website's `/api/*` routes
with a Bearer token — never the database directly.

## Commands

All scripts live in `scripts/` (zero dependencies — plain Node 18+). Run them
with `node`. Stdout is machine-readable JSON; human/status copy and the
`Acting as <email>` banner go to stderr (except `connect`, which is fully
interactive on stdout).

| Command | What it does |
| --- | --- |
| `node scripts/connect.mjs` | Interactive: email → emailed 6-digit code → credential saved + verified. Re-running verifies an existing connection instead of re-prompting. |
| `node scripts/profile.mjs get` | `{ok, profile}` — the member's public profile row, or `profile: null` if never saved. |
| `node scripts/profile.mjs set '<json>'` | Read-merge-write profile save. Keys: `displayName`, `websiteUrl`, `linkedinUrl`, `youtubeUrl`, `description`. Photo never changes here. |
| `node scripts/interests.mjs get` | `{ok, intake}` — submission + interests, or `intake: null` when the member has not done the intake. |
| `node scripts/interests.mjs set '<json>'` | Read-merge-write intake edit. Keys: `email_cadence`, `top_deliverable_type_id`, `top_task_id`, `pain_point`, `deliverable_interests`, `task_interests` (interest arrays merge per-id). `role_key` is rejected — it is echoed, never changed. |
| `node scripts/intake.mjs options [--role <key>] [--fresh]` | The catalog: `{roles, deliverable_types, tasks}`. With `--role`, tasks are filtered to `universal ∪ <role>` and capped at 10 — present exactly that set. `--fresh` busts HTTP caches (use it when recovering from `catalog_changed`). |
| `node scripts/intake.mjs create '<json>'` | Creates the intake submission; success is `{ok: true, id}` (HTTP 201). Payload: `{role_key, email_cadence, deliverable_interests: [{deliverable_type_id, interested}], task_interests: [{task_id, interested}], pain_point?}`. On `reason: "already_has_submission"` switch to edit mode (the submission may already be saved — `interests.mjs get` to check); on `reason: "catalog_changed"` re-fetch options with `--fresh` and re-confirm. |
| `node scripts/avatar.mjs upload <file>` | Uploads photo bytes (JPEG/PNG/WebP, ≤2MB) after local validation. |
| `node scripts/avatar.mjs remove` | Removes the current photo (web-parity read-merge-write save with `picture: {state: "removed"}`; the other profile fields are carried through unchanged). |

### Contract notes

- **Success shapes.** `intake.mjs create` → `{ok: true, id}` (201). The
  read-merge-write saves (`interests.mjs set`, `profile.mjs set`,
  `avatar.mjs remove`) → `{ok: true}` / `{ok: true, profile}`.
- **`deliverable_interests` needs at least one entry** — an empty array is
  rejected as an invalid submission. Duplicate `deliverable_type_id` /
  `task_id` entries in one payload are rejected too.
- **Interest arrays come back UUID-ordered**, not presentation-ranked — never
  read meaning into their order; present items in the catalog's order.
- **`--role` is mandatory before presenting tasks.** Role-less
  `intake.mjs options` is for ROLE SELECTION only; once the member picks a
  role, re-fetch with `--role <key>` and present exactly that task set.
- **`profile.mjs get` returning `profile: null`** means no prefill exists —
  ask the member directly; it is a state, not an error.
- **`top_deliverable_type_id` / `top_task_id` are vestigial** — the current
  UI never sets them (always `null`). Echo them through saves; never invent
  values for them.

## Choreography

Follow this order every session:

1. **Connect check.** Run `connect.mjs`. If it prints `Already connected as
   <email>` and verifies, continue. If it needs input, relay its prompts to
   the member and type their answers at the script's own prompt (where the
   harness allows interactive stdin; otherwise pipe the answers in the order
   asked). If it prints a signup URL, the member has no account — send them
   to that page in a browser, then run connect again. Never try to create an
   account from the terminal; it is not possible by design.
2. **Read state.** `interests.mjs get`.
3. **If `intake` is `null` → intake interview.**
   - `intake.mjs options` for roles; help the member pick ONE role (show
     label + description).
   - `intake.mjs options --role <key>`; interview through the deliverable
     types and the (≤10) tasks — for each, a clear yes/no "interested".
     Unasked items default to not-interested; include every presented item in
     the payload with an explicit boolean.
   - Ask for an optional pain point (free text) and the email cadence
     (`never` | `monthly` | `weekly` | `daily`).
   - **Confirm a summary with the member** (role, yes-items, cadence, pain
     point) before calling `intake.mjs create`.
4. **If a submission already exists → NEVER run the intake interview.** Go
   straight to edit mode: discuss changes, then `interests.mjs set` with only
   the changed fields. Two concurrent intake interviews against one account
   are unsupported.
5. **Profile interview.** `profile.mjs get`, then propose values for display
   name, website/LinkedIn/YouTube links, and a short description.
   - **Per-source consent first:** before reading the member's social
     accounts, local files, or your own memory of them to draft values, ask
     permission for EACH source by name and respect a no.
   - The member approves every value before you save it. Save with
     `profile.mjs set` carrying only approved fields.
6. **Avatar (optional).** If the member wants a photo: download the candidate
   image to a local file, describe what it shows, get explicit approval, then
   `avatar.mjs upload <file>`. Never upload an unapproved or undescribed
   image.

## Hard rules

- **Read-merge-write on every save.** `interests.mjs set` and
  `profile.mjs set` already do this internally — never bypass them with raw
  API calls, and never reconstruct a payload from memory instead of a fresh
  `get`.
- **Echo `role_key`, never change it.** Role is set at intake and
  display-only after; the scripts enforce this — do not work around it.
- **Never print tokens or raw error bodies.** No access/refresh tokens, no
  `Authorization` headers, no GoTrue `error_description`, no emails or user
  ids lifted from error responses. The scripts redact; you must too — quote
  only the scripts' own output.
- **Never export tokens to environment variables** or copy the credential
  file's contents anywhere. `AI_POWER_GUILD_CREDENTIALS_PATH` may hold a
  *path* (locked-down harnesses), never token material.
- **"Acting as <email>"** — every command prints it on stderr; surface it to
  the member at the start of a session so they know which account is live.
- **Codes are typed at the script's own prompt** where the harness allows.
  Never ask the member to paste a code into chat if connect.mjs can read it
  directly.
- **Concurrent connects are unsupported.** A new code request supersedes the
  pending one — always use the newest email, and run one connect at a time.
- **One connect per environment.** Don't copy `credentials.json` between
  machines; connect each environment separately.
- If any command says the connection is no longer valid, run `connect.mjs`
  again — once. Never retry-loop a failing credential.

## Credential file (shared contract for all guild skills)

`$AI_POWER_GUILD_CREDENTIALS_PATH` → `$XDG_CONFIG_HOME/ai-power-guild/credentials.json`
→ `~/.config/ai-power-guild/credentials.json`. File 0600, directory 0700.
`scripts/credentials.mjs` is the only code that may touch it (lock-disciplined,
rotation-safe refresh). Future guild skills import `credentials.mjs`/`api.mjs`
rather than reimplementing. Advise members who use cloud-sync/backup tools to
exclude `~/.config/ai-power-guild/`.

Known soft spot: the lockfile relies on `O_CREAT|O_EXCL`, which can be
unreliable on networked/virtual home directories — set
`AI_POWER_GUILD_CREDENTIALS_PATH` to a local path in such harnesses.

## Pre-ship checklist (ops — owned by this skill's release)

Not code; verify against the HOSTED Supabase project immediately before
publishing, in this order:

1. **"Magic Link" template: add `{{ .Token }}`.** Existing-account sign-in
   codes (what `connect.mjs` requests) are delivered through the dashboard's
   **Magic Link** template slot — without `{{ .Token }}` the member gets only
   a link, never the 6-digit code the script asks for.
2. **"Confirm signup" template: ALSO add `{{ .Token }}`**, alongside the
   template's existing confirmation link. New-account codes from the
   `/signup` page are delivered through the **Confirm signup** slot (U6
   finding), and that page asks for a code too. This is ADDITIVE: keep the
   existing confirmation link intact — `{{ .ConfirmationURL }}` on a stock
   dashboard template, or this repo's `{{ .TokenHash }}`-based
   `/auth/confirm` link (`supabase/templates/confirmation.html`) — so the web
   email-confirm flow keeps working. Do not REMOVE the confirmation link from
   any template.
3. **Hosted `otp_expiry` = 600s — verified, not assumed.** Push the config
   (`supabase config push` of `supabase/config.toml`) or set it in the
   dashboard, then CONFIRM via the dashboard that the hosted value reads 600
   after the push. Do not ship U7 until confirmed.
4. **Custom SMTP live** before announcing (built-in service ≈2 emails/hour —
   unusable for real members).
5. **Embedded constants in `scripts/config.mjs` match the live project**:
   anon key format (legacy JWT vs `sb_publishable_*` — a migration strands
   deployed copies; connect.mjs's "outdated skill" branch is the safety net,
   not a substitute) and the production `SITE_URL`.
6. **Deploying migration `0000_default_privileges.sql` requires
   `supabase db push --include-all`** — its version sorts before already-
   applied migrations, so a plain push skips it as out-of-order. Note the
   local-vs-hosted divergence: locally 0000 repairs the hardened default
   ACLs before 0001 runs; on the hosted project (created under the legacy
   defaults) it is prospective-only — an idempotent re-statement that guards
   FUTURE objects, changing nothing retroactively.
7. **0019 re-apply runbook:** any drop-and-recreate of
   `create_submission_for_user` must re-emit the revoke/grant block verbatim
   (CREATE grants EXECUTE to PUBLIC again — the 0014 gotcha). The pgTAP
   grants sweep fails the suite if this is missed; run `npm run db:test`
   after any function migration.
