#!/usr/bin/env bash
# reset-mac.sh — Remove all ai-power-guild plugin artifacts for a clean test.
# Usage: ./reset-mac.sh [--dry-run] [--full] [--project <path>]
#
# --dry-run   Show what would be removed without deleting
# --full      Also hide Node/Git from PATH (simulates missing deps)
# --project   Test project directory (default: ~/plugin-test)

set -euo pipefail

DRY_RUN=false
FULL=false
PROJECT_DIR="$HOME/plugin-test"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)  DRY_RUN=true; shift ;;
    --full)     FULL=true; shift ;;
    --project)  PROJECT_DIR="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: $0 [--dry-run] [--full] [--project <path>]"
      echo "  --dry-run   Show what would be removed without deleting"
      echo "  --full      Also hide Node/Git from PATH (creates shims that exit 127)"
      echo "  --project   Test project directory (default: ~/plugin-test)"
      exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

# Resolve ~ in PROJECT_DIR
PROJECT_DIR="${PROJECT_DIR/#\~/$HOME}"

# Honor CLAUDE_CONFIG_DIR if set, else the default ~/.claude.
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
GUILD_CONFIG_DIR="$HOME/.config/ai-power-guild"
FORGEJO_HOST="forge.singleton.ai"

OK="\033[32m✓\033[0m"
SKIP="\033[33m–\033[0m"
WARN="\033[31m!\033[0m"

step() {
  local label="$1"
  shift
  if $DRY_RUN; then
    echo -e "  $SKIP [dry-run] $label"
    return 0
  fi
  if "$@" 2>/dev/null; then
    echo -e "  $OK $label"
  else
    echo -e "  $SKIP $label (already absent or unchanged)"
  fi
}

remove_dir() {
  local dir="$1"
  local label="${2:-$dir}"
  if [[ -d "$dir" ]]; then
    step "Remove $label" rm -rf "$dir"
  else
    echo -e "  $SKIP $label (not present)"
  fi
}

remove_file() {
  local file="$1"
  local label="${2:-$file}"
  if [[ -f "$file" ]]; then
    step "Remove $label" rm -f "$file"
  else
    echo -e "  $SKIP $label (not present)"
  fi
}

# JSON key removal — uses python3 (available on macOS by default)
remove_json_key() {
  local file="$1"
  local key="$2"
  local label="$3"
  if [[ ! -f "$file" ]]; then
    echo -e "  $SKIP $label (file not present)"
    return 0
  fi
  if ! python3 -c "import json; d=json.load(open('$file')); assert '$key' in d.get('plugins', d)" 2>/dev/null; then
    echo -e "  $SKIP $label (key not present)"
    return 0
  fi
  if $DRY_RUN; then
    echo -e "  $SKIP [dry-run] $label"
    return 0
  fi
  python3 -c "
import json, sys
with open('$file') as f:
    data = json.load(f)
target = data.get('plugins', data)
target.pop('$key', None)
with open('$file', 'w') as f:
    json.dump(data, f, indent=4)
    f.write('\n')
" && echo -e "  $OK $label" || echo -e "  $WARN $label (failed to edit)"
}

# Selectively strip only the guild memory capture hooks (any group whose command
# references memory-hook.mjs) from a project's .claude/settings.json, preserving
# co-located non-memory hooks. The inverse of memory-activate.mjs's merge.
remove_memory_hooks() {
  local file="$1"
  local label="$2"
  if [[ ! -f "$file" ]]; then
    echo -e "  $SKIP $label (file not present)"
    return 0
  fi
  # Does it carry any memory hook? (exit 0 = yes)
  if ! python3 -c "
import json
d = json.load(open('$file'))
hooks = d.get('hooks', {})
found = any(
    'memory-hook.mjs' in h.get('command', '')
    for groups in hooks.values() for g in groups for h in g.get('hooks', [])
)
raise SystemExit(0 if found else 1)
" 2>/dev/null; then
    echo -e "  $SKIP $label (no memory hooks)"
    return 0
  fi
  if $DRY_RUN; then
    echo -e "  $SKIP [dry-run] $label"
    return 0
  fi
  python3 -c "
import json
with open('$file') as f:
    data = json.load(f)
hooks = data.get('hooks', {})
for event in list(hooks):
    kept = [
        g for g in hooks[event]
        if not any('memory-hook.mjs' in h.get('command', '') for h in g.get('hooks', []))
    ]
    if kept:
        hooks[event] = kept
    else:
        del hooks[event]
with open('$file', 'w') as f:
    json.dump(data, f, indent=2)
    f.write('\n')
" && echo -e "  $OK $label" || echo -e "  $WARN $label (failed to edit)"
}

echo ""
echo "=== AI Power Guild Plugin Test Reset ==="
echo "    Project dir: $PROJECT_DIR"
$DRY_RUN && echo "    Mode: DRY RUN (nothing will be deleted)"
echo ""

# -------------------------------------------------------------------------
# 1. Claude Code plugin state — try CLI first
# -------------------------------------------------------------------------
echo "--- Step 1: Claude Code plugin uninstall ---"

CLI_HANDLED=false
if command -v claude &>/dev/null; then
  if $DRY_RUN; then
    echo -e "  $SKIP [dry-run] claude plugin uninstall ai-power-guild@guild-skills"
  else
    if claude plugin uninstall ai-power-guild@guild-skills 2>/dev/null; then
      echo -e "  $OK Uninstalled via CLI"
      CLI_HANDLED=true
    else
      echo -e "  $SKIP CLI uninstall not available or failed — falling back to filesystem"
    fi
  fi
else
  echo -e "  $SKIP claude CLI not found — using filesystem cleanup"
fi

# -------------------------------------------------------------------------
# 2. Claude Code plugin filesystem (fallback / cleanup of remainder)
# -------------------------------------------------------------------------
echo ""
echo "--- Step 2: Claude Code plugin filesystem ---"

remove_dir "$CLAUDE_DIR/plugins/cache/guild-skills" "plugin cache"
remove_dir "$CLAUDE_DIR/plugins/marketplaces/guild-skills" "marketplace clone"
remove_dir "$CLAUDE_DIR/plugins/data/ai-power-guild-guild-skills" "plugin data"

if ! $CLI_HANDLED; then
  remove_json_key "$CLAUDE_DIR/plugins/installed_plugins.json" \
    "ai-power-guild@guild-skills" \
    "installed_plugins.json → ai-power-guild@guild-skills"
fi

remove_json_key "$CLAUDE_DIR/plugins/known_marketplaces.json" \
  "guild-skills" \
  "known_marketplaces.json → guild-skills"

# -------------------------------------------------------------------------
# 2b. User-scope guild skills (~/.claude/skills) — installed by install-skills.mjs
# -------------------------------------------------------------------------
echo ""
echo "--- Step 2b: User-scope guild skills ---"

USER_SKILLS_DIR="${AI_POWER_GUILD_SKILLS_DIR:-$HOME/.claude/skills}"
for s in guild-connect claudecof-setup guild-memory; do
  remove_dir "$USER_SKILLS_DIR/$s" "user-scope skill: $s"
done

# -------------------------------------------------------------------------
# 3. Guild credentials & config
# -------------------------------------------------------------------------
echo ""
echo "--- Step 3: Guild credentials & config ---"

remove_dir "$GUILD_CONFIG_DIR" "~/.config/ai-power-guild/"

# -------------------------------------------------------------------------
# 4. Git credentials for Forgejo
# -------------------------------------------------------------------------
echo ""
echo "--- Step 4: Git credentials for Forgejo ---"

if $DRY_RUN; then
  echo -e "  $SKIP [dry-run] Remove Keychain entry for $FORGEJO_HOST"
  echo -e "  $SKIP [dry-run] git credential reject for $FORGEJO_HOST"
else
  # macOS Keychain — try the internet password form (git uses this)
  if security delete-internet-password -s "$FORGEJO_HOST" 2>/dev/null; then
    echo -e "  $OK Removed Keychain internet-password for $FORGEJO_HOST"
  else
    echo -e "  $SKIP No Keychain internet-password for $FORGEJO_HOST"
  fi

  # Also try generic-password (some helpers use this)
  if security delete-generic-password -s "$FORGEJO_HOST" 2>/dev/null; then
    echo -e "  $OK Removed Keychain generic-password for $FORGEJO_HOST"
  else
    echo -e "  $SKIP No Keychain generic-password for $FORGEJO_HOST"
  fi

  # git credential reject — works with any helper
  if command -v git &>/dev/null; then
    printf 'protocol=https\nhost=%s\n\n' "$FORGEJO_HOST" | git credential reject 2>/dev/null
    echo -e "  $OK Sent git credential reject for $FORGEJO_HOST"
  else
    echo -e "  $SKIP git not available — skipping credential reject"
  fi

  # Linux plaintext fallback
  if [[ -f "$HOME/.git-credentials" ]]; then
    if grep -q "$FORGEJO_HOST" "$HOME/.git-credentials" 2>/dev/null; then
      grep -v "$FORGEJO_HOST" "$HOME/.git-credentials" > "$HOME/.git-credentials.tmp"
      mv "$HOME/.git-credentials.tmp" "$HOME/.git-credentials"
      echo -e "  $OK Removed $FORGEJO_HOST from ~/.git-credentials"
    else
      echo -e "  $SKIP $FORGEJO_HOST not in ~/.git-credentials"
    fi
  fi
fi

# -------------------------------------------------------------------------
# 5. Scaffolded project & test project dir
# -------------------------------------------------------------------------
echo ""
echo "--- Step 5: Test project & scaffolded project ---"

# Remove any symlinks (the scaffold links .claude/skills -> repo/skills) before
# the recursive delete so rm never traverses a link out of the project tree.
if [[ -d "$PROJECT_DIR" ]]; then
  if $DRY_RUN; then
    echo -e "  $SKIP [dry-run] remove symlinks under $PROJECT_DIR (e.g. .claude/skills)"
  else
    find "$PROJECT_DIR" -type l -exec rm -f {} + 2>/dev/null || true
  fi
fi

# Strip the guild memory capture hooks from the project's settings BEFORE the
# directory is deleted — matters when --project points at a real project to keep.
remove_memory_hooks "$PROJECT_DIR/.claude/settings.json" "project memory hooks"

remove_dir "$PROJECT_DIR" "test project ($PROJECT_DIR)"

# -------------------------------------------------------------------------
# 6. Optional: hide Node/Git (--full)
# -------------------------------------------------------------------------
if $FULL; then
  echo ""
  echo "--- Step 6: Hide Node & Git from PATH (--full) ---"

  SHIM_DIR="$HOME/.guild-test-shims"

  if $DRY_RUN; then
    echo -e "  $SKIP [dry-run] Would create shim dir at $SHIM_DIR"
    echo -e "  $SKIP [dry-run] Would create node/git shims that exit 127"
    echo -e "  $SKIP [dry-run] Add to PATH with: export PATH=\"$SHIM_DIR:\$PATH\""
  else
    mkdir -p "$SHIM_DIR"

    # Node shim
    cat > "$SHIM_DIR/node" << 'SHIM'
#!/bin/sh
echo "node: command not found (guild-test shim)" >&2
exit 127
SHIM
    chmod +x "$SHIM_DIR/node"

    # Git shim
    cat > "$SHIM_DIR/git" << 'SHIM'
#!/bin/sh
echo "git: command not found (guild-test shim)" >&2
exit 127
SHIM
    chmod +x "$SHIM_DIR/git"

    echo -e "  $OK Created shims in $SHIM_DIR"
    echo ""
    echo "  To activate:   export PATH=\"$SHIM_DIR:\$PATH\""
    echo "  To deactivate: export PATH=\"\${PATH#$SHIM_DIR:}\""
    echo "  To remove:     rm -rf $SHIM_DIR"
  fi
fi

# -------------------------------------------------------------------------
# Done
# -------------------------------------------------------------------------
echo ""
if $DRY_RUN; then
  echo "=== Dry run complete. No changes were made. ==="
else
  echo "=== Reset complete. Ready for a fresh install. ==="
fi
echo ""
