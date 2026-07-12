# Hermes agent compatibility — placement for guild-connect

*Phase 2 deliverable of [requests/2026-07-12-guild-connect-hermes.md](requests/2026-07-12-guild-connect-hermes.md).
Sources: the botbox/humanpower checkouts (this deployment's ground truth) and the
official Hermes Agent docs (hermes-agent.nousresearch.com). Written 2026-07-12.*

## Verdict

**Porting is small.** Hermes Agent (NousResearch/hermes-agent, MIT, Feb 2026) is
natively compatible with the **agentskills.io standard** — the same
`SKILL.md`-folder format Claude Code uses — and both the generic installer and
this deployment's fly.io image ship Node and git. guild-connect's scripts should
run as-is; the work is (a) an install path for `~/.hermes/skills/`, (b)
platform-conditional choreography wording, and (c) live verification of a short
list of unknowns.

## The two Hermes environments

| | Generic Hermes install | This deployment (botbox on fly.io) |
|---|---|---|
| Runtime | Python 3.11 agent, ~70 tools incl. terminal + file tools | Same agent, seeded into a fly.io machine |
| OS / user | any (Linux/macOS/WSL2) | Ubuntu 24.04, user `hermes`, HOME `/home/hermes` |
| Node | bundled Node 22 by installer | bundled by the same installer (version **unverified** — gap G2) |
| git | the one install prerequisite | apt-installed in the image (`botbox/deploy/fly/Dockerfile`) |
| Skills dir | `~/.hermes/skills/<category>/<name>/` | same, on the persistent volume |
| Persistence | local disk | fly volume `hermes_data` mounted at `/home/hermes` (5 GB) — the **whole HOME persists** across restart/recreate/suspend |
| Config/secrets | `~/.hermes/config.yaml` + `~/.hermes/.env` | same; `OPENROUTER_API_KEY` injected as machine env, written to `.env`, scrubbed |
| Skill install | `hermes skills install <github|url|hub>` (+ security scanner, trust tiers) | additionally: `GUILD_SKILLS` env (JSON `{url, kind: git|archive, target}`) installed by `entrypoint.sh` into `~/.hermes/<target>` at first boot |

## Placement recommendation

1. **Skill folders** → `~/.hermes/skills/<name>/` (e.g.
   `~/.hermes/skills/guild-connect/`). Two delivery paths, both existing
   plumbing:
   - `hermes skills install` pointed at `zingleton/skills` (member-initiated,
     scanner-gated), or
   - a `GUILD_SKILLS` entry at provision time (humanpower-initiated;
     `entrypoint.sh install_skills()` already does this).
2. **Credential file** → keep the existing contract unchanged:
   `~/.config/ai-power-guild/credentials.json` resolves to
   `/home/hermes/.config/...` — on the volume, so it **persists**. No Hermes
   changes needed; `$AI_POWER_GUILD_CREDENTIALS_PATH` stays the escape hatch for
   containerized terminal backends. (The botbox desktop client already shares
   this exact file contract — `botbox/src-tauri/src/guild/mod.rs`.)
3. **Personal repo clone** → `~/ai-power-guild/repo` (guild-connect's new
   standalone default from the Step 7 rework) — under HOME, so it persists.
4. **Git credential** → *no new work expected.* The image has git but **no
   credential helper and no keychain** (headless Ubuntu). `git-setup.mjs`
   already handles exactly this: no secret service → it configures plaintext
   `credential.helper store` (`~/.git-credentials`, on the volume) and sets
   `plaintextWarning: true`. Surface the warning to the member as the SKILL.md
   already instructs. The Forgejo token is bounded-lifetime, limiting plaintext
   exposure; re-mint via re-running git-setup.

## What already works (no changes)

- **SKILL.md format**: Hermes reads agentskills.io skills natively; unknown
  (Claude-specific) frontmatter is ignored. Skills auto-expose as `/slash-commands`.
- **Zero-dependency Node ≥ 18 scripts**: generic installs bundle Node 22.
- **Credential store contract**: XDG path under a persistent HOME; the
  deliberate no-keychain design (humanpower plan KTD4: "harness sandboxes hang
  on keychain") turns out to be exactly right for this image.
- **git-setup's plaintext fallback** (above).
- **Phase 1 decoupling**: Step 7 (git + personal repo) is already
  platform-neutral; the Chief-of-Staff handoff that made onboarding
  Claude-Code-shaped is gone.

## Gaps / required changes (ranked)

- **G1 — installer target.** `install-skills.mjs` only knows
  `~/.claude/skills/`. Add a Hermes target (`~/.hermes/skills/`, honoring
  `$HERMES_HOME`), detected or flag-selected. Alternative: document
  `hermes skills install` as the Hermes-native path and leave the .mjs installer
  Claude-only. *(Decide in Phase 3 — recommend doing both: detect + document.)*
- **G2 — Node version on the live bot unverified.** The image bundles whatever
  hermes-agent's `install.sh` shipped; nothing pins it in botbox. Verify with
  `doctor.mjs` on the running agent.
- **G3 — PATH for agent-spawned shells.** `node`/`hermes` reach PATH via
  `start-hermes.sh` (`~/.local/bin`); whether a skill's shell spawned by the
  agent inherits that PATH is unverified. If not, the SKILL.md Step 0 gate
  catches it, but we may want an absolute-path hint.
- **G4 — Claude-specific choreography wording.** Steps 8 ("Make the skills
  durable (Claude Code)") and scattered "Claude Code" phrasing need
  platform-conditional text ("in Claude Code do X / in Hermes do Y") and
  agent-neutral voice (Hermes runs arbitrary models).
- **G5 — no provision-time guild bootstrap.** Nothing in botbox/humanpower
  authenticates a bot to the guild or writes `credentials.json` at provision.
  Connect must run *in-session on the bot* (member drives the send→verify flow
  through the agent). A provision-time bootstrap (new `GUILD_*` env or
  `execOnMachine` write) is possible **future humanpower work — out of scope**.
- **G6 — first-boot seed hazard.** The volume seed copy runs in the background;
  writing `credentials.json` before "first-boot setup complete" could collide
  with the seed's `tar -xpf` over `/home/hermes`. In-session connect after boot
  avoids this naturally; provision-time bootstrap (G5) must sequence after it.
- **G7 — scanner/trust tiers.** Hub installs get scanned for exfiltration
  patterns; the SKILL.md should keep stating plainly that it calls
  `pg.singleton.ai/api/*` with a Bearer token, so a scan reads intent, not
  exfiltration.

## Resolved open question (feed back to humanpower)

`humanpower/docs/plans/2026-07-05-001-feat-skills-delivery-pipeline-plan.md`
lists "Hermes profile skills-directory convention (verify on a live Hermes
agent)" as open. **Answer: `~/.hermes/skills/<name>/`** (agentskills.io layout;
`$HERMES_HOME` override; botbox `entrypoint.sh` installs `GUILD_SKILLS` entries
into `~/.hermes/<target>` and its README documents `skills/<name>` targets).

## Live verification results (2026-07-12, app `hermes-ffbbcbe4c1cf4e26`)

Executed on the running fly.io agent (restart-persistence test skipped by
request; persistence argued from the `/home/hermes` volume mount):

- **G1 closed.** `install-skills.mjs` now auto-detects the harness
  (`AI_POWER_GUILD_SKILLS_DIR` → `CLAUDECODE` → `$HERMES_HOME`/`~/.hermes` →
  `~/.claude/skills` fallback) and installed the bootstrap pair into
  `/home/hermes/.hermes/skills/` on the bot. Layout note: the live agent has
  skills at **both** depths (`skills/<name>/SKILL.md` and
  `skills/<category>/<name>/SKILL.md`), so the flat install is discovered.
- **G2 closed.** Image bundles **Node v22.23.1** + git 2.43.0; `doctor.mjs`
  passes from the installed skill path.
- **G3 closed.** `node`/`git` resolve from a `bash -lc` shell as the `hermes`
  user with the system PATH alone.
- **G4 closed.** Choreography Step 8 is now platform-conditional
  (Claude Code / Hermes / other-harness override).
- **Full matrix green on both platforms**: doctor, connect
  (`send`→relay→`verify`, per-environment credential), git-setup (macOS:
  `osxkeychain`; bot: `store` + plaintext warning **exactly as predicted**,
  `~/.git-credentials` on the volume), repo-setup (bot clone at
  `/home/hermes/ai-power-guild/repo`, credential file `0600`).
- **Operational notes:** access via `fly ssh console -a <app>` (root) +
  `gosu hermes bash -lc '...'`; file transfer via `fly ssh sftp put`. The
  machine **auto-suspends when idle** — expect to `fly machine start` it
  between test sessions.

## Phase 3 test plan (live bot)

Access: the running agent's fly.io machine (SSH-over-WebSocket via botbox, or
`fly ssh console` from this machine's key). No new machines/volumes without
explicit confirmation.

1. `node --version && git --version`, then `doctor.mjs` → closes G2/G3.
2. Place the skills under `~/.hermes/skills/` (G1 path decision) and confirm the
   agent surfaces guild-connect (slash command / skill listing).
3. `connect.mjs status` → `send` → member relays emailed code → `verify` →
   credential lands at `/home/hermes/.config/ai-power-guild/credentials.json`
   (0600) and survives a machine restart.
4. `git-setup.mjs` → expect `helper: "store", plaintextWarning: true`;
   `git ls-remote` the personal repo with no prompt.
5. `repo-setup.mjs` targetDir `~/ai-power-guild` → clone + seed; restart the
   machine; confirm repo + credential persist.
6. Same matrix on Claude Code locally (note: this machine currently reports
   `reconnect_required`, so step 3 runs here too).
