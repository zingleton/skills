# guild-connect — the credential contract for guild skills

`scripts/credentials.mjs` is the published contract every AI Power Guild skill
shares. One connection serves the whole environment: any guild skill reads the
same credential file and gets the same account.

## The credential file

- **Path:** `$AI_POWER_GUILD_CREDENTIALS_PATH` if set, else
  `$XDG_CONFIG_HOME/ai-power-guild/credentials.json`, else
  `~/.config/ai-power-guild/credentials.json`. The env var holds only a path —
  never token material.
- **Permissions:** directory `0700`, file `0600`, created before the first
  token is written.
- **Shape (version 1):**

  ```json
  {
    "version": 1,
    "supabase_url": "https://<project>.supabase.co",
    "access_token": "<jwt>",
    "refresh_token": "<opaque>",
    "expires_at": 1765500000,
    "user_id": "<auth uuid>",
    "email": "member@example.com"
  }
  ```

## Rules (non-negotiable for any skill that touches the file)

1. **Refresh only through `getValidAccessToken()`** — it implements the lock
   discipline: acquire the sidecar lock (`credentials.json.lock`, exclusive
   create, 100ms retry, 10s timeout, locks older than ~30s broken) →
   **re-read the file** (a sibling may have already refreshed — skip the
   network call if more than 60s of validity remain) → refresh via GoTrue →
   atomic write (tmp file + rename, 0600) → unlock. Supabase refresh tokens
   are single-use with a ~10s reuse window; a stale refresh outside that
   window kills the whole session family for every skill on the machine.
2. **On `invalid_grant`:** re-read once (a sibling may have won the race);
   if still dead, clear the file and surface "Run connect again". Never
   retry-loop a dead refresh token.
3. **Never print token material** — not to stdout, stderr, error messages, or
   logs. In agent harnesses the transcript is a persistence surface.
4. **Never export tokens as environment variables**, even for convenience —
   env leaks to child processes and transcripts. Pass the path env var if a
   harness needs a custom location.
5. **Print `Acting as <email>` (stderr) at the start of every command** so
   cross-account contamination on shared machines is visible immediately.
6. **All data access goes through the app API** (`api.mjs`) with the Bearer
   token — never PostgREST/Storage directly. The API is the stable contract;
   deployed skill copies survive schema changes that way.
7. **Read-merge-write for whole-payload endpoints** (`POST /api/profile`,
   `POST /api/user-profile`): GET first, merge your changes, POST the full
   payload, echo `role_key` unchanged.

## Backup/cloud-sync caveat (tell members when it comes up)

`0600` stops other local users — not the member's own backup or cloud-sync
tools. If iCloud/Dropbox/etc. cover `~/.config`, advise excluding
`ai-power-guild/`. Refresh-token rotation bounds what a stale synced copy can
do, and "Disconnect connected devices" on `/account` revokes everything at
once.

## Connect / disconnect lifecycle

- `connect.mjs` signs in with an emailed one-time code (existing accounts
  only; account creation happens on the unlisted `/signup` page it links to).
- Revocation: the member uses "Disconnect connected devices" on `/account`.
  Every skill's next API call gets a 401, `api.mjs` clears the file after one
  failed refresh, and the member reconnects when ready.

The pre-ship operational checklist (email template slots, hosted OTP expiry,
custom SMTP, embedded key verification) lives in `SKILL.md`.

## Git access (durable git credential)

`git-setup.mjs` extends the connection to ordinary git: it provisions the
member's Forgejo git access and installs a **separate, durable, host-scoped,
per-device git credential** into the OS credential store via
`git credential approve`. Afterwards `git clone/pull/push` of the member's role
plugin repo and private personal repo works with no prompt, and a local agent
reusing the same git client needs no extra auth.

It reuses the Guild credential through `api.mjs` (a bearer call to
`/api/account/git-access`) — it never reads or copies the credential file itself.
The returned git token is piped straight into git and is **never** printed;
stdout carries only `{ok, forgejoHost, username, helper, plaintextWarning}`.
Linux hosts with no secret service fall back to git's plaintext `store` with an
explicit warning. Same "one credential per environment, don't copy between
machines" rule as the Guild credential; rotation is member-initiated (re-run
`git-setup`).

## Tests

`tests/` holds the standalone unit tests (Node's built-in runner, zero
dependencies). Run them from the repo root with `npm test`, or directly:

```
node --test "skills/guild-connect/tests/**/*.test.mjs"
```

Coverage: the credential store + sidecar lock + rotation-safe refresh
(`credentials.test.mjs`), the 401 → single-refresh-retry + redaction discipline
(`api.test.mjs`), and the pure helpers — connect classifiers, `sniffImageType`,
`mergeById` / `validateInterestEdits`, `parseJsonArg` (`pure-functions.test.mjs`),
and the git-credential install flow — host-scoped stdin payload, helper selection,
token never logged, failure modes (`git-setup.test.mjs`, all deps injected).
Refresh is exercised through an injected `fetch`; nothing hits the network.
Unix-permission (`0600`/`0700`) and chmod-based write-failure assertions are
skipped on Windows, where those modes aren't enforced — they run on POSIX/CI.
The end-to-end tests that drive the real scripts against a live Supabase stack
live in the app repo (`tests/skill-credentials.test.ts`, section 5); they can't
run standalone because they import the app's route handlers and DB types.
