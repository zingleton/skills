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

**Commands that take a `'<json>'` argument** (`repo-setup`, `interests set`,
`profile set`, `intake create`) also accept a **file path** or `-` (stdin). Pass
a path to avoid Claude Code's "shell syntax that cannot be statically analyzed"
prompt: write the JSON to a temp file with the Write tool, then
`node scripts/<cmd>.mjs <path>.json`. A plain path has no braces or quotes for
the permission analyzer to flag; inline JSON still works when you need it.

| Command | What it does |
| --- | --- |
| `node scripts/doctor.mjs` | Preflight (run FIRST, before connect): checks Node ≥ 18 and git are present and prints copy-pasteable fixes; exits non-zero if not. No credential, no network. Stdout `{ok, checks}`. Does NOT check plugin freshness (that's not knowable pre-connect — see the choreography note on `stale_skill`). |
| `node scripts/connect.mjs` | Interactive (human at a terminal): email → emailed 6-digit code → credential saved + verified. Re-running verifies an existing connection instead of re-prompting. **Do not use this form from an agent harness** — it blocks on stdin for a code that only arrives after the email step. Use the trio below instead. |
| `node scripts/connect.mjs status` | Non-interactive connection check. `{ok: true, status: "connected", email}` when live; `{ok: false, status: "not_connected", signup_url}` when no credential; `{ok: false, status: "reconnect_required"}` when the stored session is dead (the file is cleared). JSON on stdout, `Acting as`/copy on stderr. This is the agent's connect-check — it never prompts. |
| `node scripts/connect.mjs send <email>` | Non-interactive: request a SIGN-IN-ONLY code (never creates accounts). `status`: `sent` \| `unknown_email` (carries `signup_url`) \| `code_already_pending` \| `stale_skill` \| `invalid_email` \| `error`. |
| `node scripts/connect.mjs verify <email> <code>` | Non-interactive: redeem ONE code from the newest `send` email, then save + round-trip + API-verify the credential. `status`: `connected` \| `bad_code` (request a fresh code and verify again) \| `save_failed` (carries `path`) \| `verify_failed` \| `error`. No in-process retry — one attempt per call. |
| `node scripts/profile.mjs get` | `{ok, profile}` — the member's public profile row, or `profile: null` if never saved. |
| `node scripts/profile.mjs set '<json>'` | Read-merge-write profile save. Keys: `displayName`, `websiteUrl`, `linkedinUrl`, `youtubeUrl`, `description`. Photo never changes here. |
| `node scripts/interests.mjs get` | `{ok, intake}` — submission + interests, or `intake: null` when the member has not done the intake. |
| `node scripts/interests.mjs set '<json>'` | Read-merge-write intake edit. Keys: `email_cadence`, `top_deliverable_type_id`, `top_task_id`, `pain_point`, `deliverable_interests`, `task_interests` (interest arrays merge per-id). `role_key` is rejected — it is echoed, never changed. |
| `node scripts/intake.mjs options [--role <key>] [--fresh]` | The catalog: `{roles, deliverable_types, tasks}`. With `--role`, tasks are filtered to `universal ∪ <role>` and capped at 10 — present exactly that set. `--fresh` busts HTTP caches (use it when recovering from `catalog_changed`). |
| `node scripts/intake.mjs create '<json>'` | Creates the intake submission; success is `{ok: true, id}` (HTTP 201). Payload: `{role_key, email_cadence, deliverable_interests: [{deliverable_type_id, interested}], task_interests: [{task_id, interested}], pain_point?}`. On `reason: "already_has_submission"` switch to edit mode (the submission may already be saved — `interests.mjs get` to check); on `reason: "catalog_changed"` re-fetch options with `--fresh` and re-confirm. |
| `node scripts/avatar.mjs upload <file>` | Uploads photo bytes (JPEG/PNG/WebP, ≤2MB) after local validation. |
| `node scripts/avatar.mjs remove` | Removes the current photo (web-parity read-merge-write save with `picture: {state: "removed"}`; the other profile fields are carried through unchanged). |
| `node scripts/git-setup.mjs` | One-time: provisions the member's Forgejo git access and installs a durable, per-device git credential into the OS store so plain `git clone/pull/push` works with no prompt. Stdout is `{ok, forgejoHost, username, helper, plaintextWarning}` — never the token. Re-running replaces this device's token. |
| `node scripts/repo-setup.mjs '<json>'` | Clones the member's `personal` repo into `<targetDir>/repo` and seeds the COF's durable layer (memory/skills/Tools) — seed-only-if-absent, commit+push only when it seeded, **never pulls** an existing clone (the COF owns its own sync). Takes `{targetDir, forgejoHost, username}`; host+username come from `git-setup`'s stdout — it **never re-mints** the git token. Stdout `{ok, repoDir, cloned, seeded, pushed}`. Safe to re-run. |

### Contract notes

- **Two different "profile" endpoints — don't cross them.** The app exposes two
  surfaces that both say "profile", and the scripts map to them 1:1:
  - **Intake interests** → `/api/profile` → `interests.mjs get/set` (and the
    base `intake.mjs create` reads/writes). Holds `role_key`, `email_cadence`,
    `deliverable_interests`, `task_interests`, `pain_point`. `interests.mjs get`
    returns `{ok, intake}`.
  - **Public profile** → `/api/user-profile` (+ `/avatar`) → `profile.mjs` and
    `avatar.mjs`. Holds `displayName`, links, `description`, photo.
    `profile.mjs get` returns `{ok, profile}`.
  Pick the script by which data you mean, not by the word "profile": editing the
  display name is `profile.mjs`; editing the email cadence is `interests.mjs`.
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

**One-line invocation.** A member can kick off the whole onboarding with a single
sentence — e.g. *"Onboard andy@singleton.ai using the guild-connect skill from
https://github.com/zingleton/skills."* When that happens:
- **Use the email they gave you** for the connect step — don't re-ask for it.
- **If guild-connect isn't installed yet** (you're reading this from a fresh
  clone of the repo, not from `~/.claude/skills/`), run the scripts from the
  clone's `skills/guild-connect/scripts/`. The final step (8) then installs the
  skills at user scope so future sessions have them without a clone.
- Then run the steps below in order. This *is* the onboarding script — there is
  no separate prompt to paste.

Run `doctor.mjs` FIRST as a preflight — if it fails, surface its fixes and stop; the rest of the flow needs Node + git. (A missing or too-old Node can't even start `doctor.mjs`, so a shell-level `node --version` check precedes it.) Then follow this order every session. The whole flow is **re-runnable**: each step is idempotent and each script derives its own done-state, so a re-run skips completed steps (`connect.mjs status` for the connection, `git ls-remote` for git access, a `repo/.git` check for the clone, `CLAUDE.md` existence for the scaffold) — the scripts, not this prose, are what make re-running safe.

1. **Connect check.** Run `connect.mjs status`. On `status: "connected"`,
   continue. On `not_connected` or `reconnect_required`, link the account with
   the non-interactive two-step (one process can't pause for an emailed code):
   - **If the member already has a code in hand** — they created an account on
     the web and were shown (or emailed) an email + 6-digit code — skip `send`
     and go straight to `connect.mjs verify <email> <code>`. If that returns
     `bad_code` (the code expired or was already used), point them at the
     **Connect your AI** page (linked from their profile) to get a fresh code,
     then verify that. A terminal `send <email>` also works if they'd rather.
   - Otherwise, use the email the member gave you in the request (only ask if
     they didn't supply one), then `connect.mjs send <email>`.
   - On `sent`, ask the member to read the 6-digit code from the NEWEST email
     and relay it to you, then `connect.mjs verify <email> <code>`. On
     `bad_code` request a fresh code (`send` again) and verify the newest one —
     never loop on a stale code.
   - On `unknown_email`, the member has no account yet. The `signup_url` in the
     response is **pre-filled with their email** — give them that exact link and
     ask them to open it and submit their email. That creates their account and
     emails them a 6-digit code (the signup page sends it). They do NOT need to
     type the code into the web page — have them read it back to you. Then go
     straight to `connect.mjs verify <email> <code>` with that code. **Do NOT
     run `send` again** — the signup already sent the code; telling the member
     you'll "send another code" is wrong. Only if `verify` returns `bad_code`
     (the code was used on the web or expired) do you `send` a fresh sign-in
     code — the account now exists, so it succeeds — and verify that. Never
     create an account from the terminal; it is not possible by design.
   - On `stale_skill`, the skill copy is outdated — tell the member to update
     guild-connect.
   (A human running this themselves can instead use bare `connect.mjs` and type
   the code at its own prompt; the two-step above is the path for agent
   harnesses, where interactive stdin isn't available.)
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
7. **Git access, then the Personal Chief of Staff (Claude Code only).** Once the
   member has a saved profile (`profile.mjs get` returns a non-null `profile`)
   **and** you are running inside Claude Code with the sibling `claudecof-setup`
   skill available in this plugin:
   - Run `git-setup.mjs` to install the durable git credential (see "Git access"
     below), and **capture its stdout `{forgejoHost, username}`** — these get
     threaded onward so nothing has to re-mint the git token.
   - Offer the Chief of Staff setup plainly (e.g. "Want me to set up a Personal
     Chief of Staff seeded from your guild profile?"). If the member says yes,
     invoke `claudecof-setup`, **passing along `forgejoHost` and `username`** from
     git-setup. That skill picks the project location, clones the member's
     `personal` repo into `<project>/repo` via `repo-setup.mjs` (using those
     values — never re-fetching them), and scaffolds a personalized `CLAUDE.md`
     that reuses the profile and interests you just gathered.
   - **Skip it** when there is no saved profile yet, when `claudecof-setup`
     isn't available, or when you are not in Claude Code — that skill scaffolds
     a Claude Code project and only makes sense there. Don't push if the member
     declines; this is a suggestion, not part of the account setup.
8. **Make the skills durable (Claude Code).** The skills work this session; offer
   the member **two equal ways** to keep them for every future session, and let
   them choose:
   - **Terminal (marketplace plugin).** Give them this to paste into a terminal —
     **not** a running session (plugin install is a host op that won't take effect
     mid-session): `claude plugin marketplace add zingleton/skills` then
     `claude plugin install ai-power-guild@guild-skills`. Cleanest ongoing
     permissions; update later with `claude plugin update ai-power-guild@guild-skills`.
   - **In-session (user-scope install).** Run `node scripts/install-skills.mjs` to
     copy `guild-connect`, `claudecof-setup`, and `guild-memory` into
     `~/.claude/skills/`. It may need a one-time permission grant (it writes
     user-scope config); re-running it is the update path.
   Either way, remind them memory is the opt-in `guild-memory` skill — off until
   they activate it for a project. (Skip when not in Claude Code.)

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
- **Codes go straight to `verify`, never into your own memory or logs.** When
  a human runs bare `connect.mjs`, they type the code at the script's own
  prompt — don't ask them to paste it into chat. In an agent harness the member
  relays the code once and you pass it directly to `connect.mjs verify`; use it
  for that single call and never echo it back.
- **Concurrent connects are unsupported.** A new code request supersedes the
  pending one — always use the newest email, and run one connect at a time.
- **One connect per environment.** Don't copy `credentials.json` between
  machines; connect each environment separately.
- If any command says the connection is no longer valid, run `connect.mjs`
  again — once. Never retry-loop a failing credential.

## Git access (durable git credential)

`git-setup.mjs` installs a **separate, durable git credential** into the OS
credential store (Git Credential Manager / macOS Keychain / Windows Credential
Manager / Linux libsecret). After it runs, ordinary `git clone/pull/push` of the
member's role plugin repo and their private personal repo works with no prompt,
and a local agent (Codex, Claude Code) reusing the same git client needs **no
separate auth** — it loads a locally cloned skill repo like any other.

- **One command:** `node scripts/git-setup.mjs`. It calls the app's
  `/api/account/git-access` route with the stored Guild credential, then pipes
  the freshly minted token into `git credential approve`. Stdout is
  `{ok, forgejoHost, username, helper, plaintextWarning}` — the token is never
  printed.
- **Host-scoped, per-device, replace-on-rerun.** The token is stored only for the
  Forgejo host; re-running replaces THIS device's token rather than accumulating.
  Rotation is member-initiated — re-run `git-setup` to install a fresh token (the
  server cannot push a credential into your OS store).
- **One credential per environment — don't copy between machines.** Run
  `git-setup` on each machine separately.
- **Lost / shared device:** the credential persists in the OS store. "Disconnect
  connected devices" on `/account` revokes the member's git tokens; account
  deletion revokes all forge access. Never run `git-setup` on a shared machine you
  don't control.
- **Linux without a secret service** falls back to git's plaintext `store`
  (`~/.git-credentials`) and the command WARNS about it — protect that machine.

## Portable memory → the `guild-memory` skill

Portable memory (the member's personal memory, backed by the Guild's self-hosted
Hindsight server) lives in its own sibling skill, **`guild-memory`** — it is not
part of guild-connect and is **not** auto-loaded. Memory is opt-in and
per-project: it captures nothing until the member activates it for a chosen
project, and onboarding never turns it on.

When the member asks to set up, activate, search, or forget memory, use the
`guild-memory` skill (`memory-setup`, `memory-activate`, `memory`). It reuses
this skill's `credentials.mjs` / `api.mjs` plumbing, so the two install together
as user-scope siblings.

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
