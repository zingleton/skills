# reset-win.ps1 — Remove all ai-power-guild plugin artifacts for a clean test.
# Usage: .\reset-win.ps1 [-DryRun] [-Full] [-Project <path>]
#
# -DryRun    Show what would be removed without deleting
# -Full      Also hide Node/Git from PATH (creates shims that exit 127)
# -Project   Test project directory (default: ~\plugin-test)

param(
    [switch]$DryRun,
    [switch]$Full,
    [string]$Project = "$env:USERPROFILE\plugin-test"
)

$ErrorActionPreference = "Continue"

$ClaudeDir = "$env:APPDATA\.claude"
# Windows XDG_CONFIG_HOME fallback — Node's os.homedir() + .config, but the
# credentials.mjs code checks XDG_CONFIG_HOME first, then falls back to
# homedir()/.config. On Windows %APPDATA% is the conventional config home,
# but the guild scripts use Node's homedir() which is %USERPROFILE%. Check both.
$GuildConfigDirs = @(
    "$env:USERPROFILE\.config\ai-power-guild",
    "$env:APPDATA\ai-power-guild"
)
$ForgejoHost = "forge.singleton.ai"

function Write-Step {
    param([string]$Label, [string]$Status = "ok")
    switch ($Status) {
        "ok"   { Write-Host "  [+] $Label" -ForegroundColor Green }
        "skip" { Write-Host "  [-] $Label" -ForegroundColor Yellow }
        "dry"  { Write-Host "  [-] [dry-run] $Label" -ForegroundColor Yellow }
        "warn" { Write-Host "  [!] $Label" -ForegroundColor Red }
    }
}

function Remove-DirSafe {
    param([string]$Path, [string]$Label)
    if (-not $Label) { $Label = $Path }
    if (Test-Path $Path -PathType Container) {
        if ($DryRun) {
            Write-Step "$Label" "dry"
        } else {
            Remove-Item -Recurse -Force $Path -ErrorAction SilentlyContinue
            Write-Step "Remove $Label" "ok"
        }
    } else {
        Write-Step "$Label (not present)" "skip"
    }
}

function Remove-FileSafe {
    param([string]$Path, [string]$Label)
    if (-not $Label) { $Label = $Path }
    if (Test-Path $Path -PathType Leaf) {
        if ($DryRun) {
            Write-Step "$Label" "dry"
        } else {
            Remove-Item -Force $Path -ErrorAction SilentlyContinue
            Write-Step "Remove $Label" "ok"
        }
    } else {
        Write-Step "$Label (not present)" "skip"
    }
}

function Remove-JsonKey {
    param([string]$File, [string]$Key, [string]$Label)
    if (-not (Test-Path $File)) {
        Write-Step "$Label (file not present)" "skip"
        return
    }
    $json = Get-Content $File -Raw | ConvertFrom-Json
    $target = if ($json.plugins) { $json.plugins } else { $json }
    if (-not ($target.PSObject.Properties.Name -contains $Key)) {
        Write-Step "$Label (key not present)" "skip"
        return
    }
    if ($DryRun) {
        Write-Step "$Label" "dry"
        return
    }
    $target.PSObject.Properties.Remove($Key)
    $json | ConvertTo-Json -Depth 10 | Set-Content $File -Encoding UTF8
    Write-Step "$Label" "ok"
}

Write-Host ""
Write-Host "=== AI Power Guild Plugin Test Reset ===" -ForegroundColor Cyan
Write-Host "    Project dir: $Project"
if ($DryRun) { Write-Host "    Mode: DRY RUN (nothing will be deleted)" -ForegroundColor Yellow }
Write-Host ""

# -------------------------------------------------------------------------
# 1. Claude Code plugin state — try CLI first
# -------------------------------------------------------------------------
Write-Host "--- Step 1: Claude Code plugin uninstall ---"

$cliHandled = $false
if (Get-Command claude -ErrorAction SilentlyContinue) {
    if ($DryRun) {
        Write-Step "claude plugin uninstall ai-power-guild@guild-skills" "dry"
    } else {
        try {
            claude plugin uninstall ai-power-guild@guild-skills 2>$null
            Write-Step "Uninstalled via CLI" "ok"
            $cliHandled = $true
        } catch {
            Write-Step "CLI uninstall not available or failed - falling back to filesystem" "skip"
        }
    }
} else {
    Write-Step "claude CLI not found - using filesystem cleanup" "skip"
}

# -------------------------------------------------------------------------
# 2. Claude Code plugin filesystem
# -------------------------------------------------------------------------
Write-Host ""
Write-Host "--- Step 2: Claude Code plugin filesystem ---"

Remove-DirSafe "$ClaudeDir\plugins\cache\guild-skills" "plugin cache"
Remove-DirSafe "$ClaudeDir\plugins\marketplaces\guild-skills" "marketplace clone"
Remove-DirSafe "$ClaudeDir\plugins\data\ai-power-guild-guild-skills" "plugin data"

if (-not $cliHandled) {
    Remove-JsonKey "$ClaudeDir\plugins\installed_plugins.json" `
        "ai-power-guild@guild-skills" `
        "installed_plugins.json -> ai-power-guild@guild-skills"
}

Remove-JsonKey "$ClaudeDir\plugins\known_marketplaces.json" `
    "guild-skills" `
    "known_marketplaces.json -> guild-skills"

# -------------------------------------------------------------------------
# 3. Guild credentials & config
# -------------------------------------------------------------------------
Write-Host ""
Write-Host "--- Step 3: Guild credentials & config ---"

foreach ($dir in $GuildConfigDirs) {
    Remove-DirSafe $dir $dir
}

# -------------------------------------------------------------------------
# 4. Git credentials for Forgejo
# -------------------------------------------------------------------------
Write-Host ""
Write-Host "--- Step 4: Git credentials for Forgejo ---"

if ($DryRun) {
    Write-Step "cmdkey /delete for $ForgejoHost" "dry"
    Write-Step "git credential reject for $ForgejoHost" "dry"
} else {
    # Windows Credential Manager
    try {
        $result = cmdkey /delete:git:https://$ForgejoHost 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Step "Removed credential for git:https://$ForgejoHost" "ok"
        } else {
            Write-Step "No credential for git:https://$ForgejoHost in Credential Manager" "skip"
        }
    } catch {
        Write-Step "cmdkey failed" "skip"
    }

    # Also try the LegacyGeneric form
    try {
        cmdkey /delete:LegacyGeneric:target=git:https://$ForgejoHost 2>$null
    } catch {}

    # git credential reject — works with any helper
    if (Get-Command git -ErrorAction SilentlyContinue) {
        "protocol=https`nhost=$ForgejoHost`n`n" | git credential reject 2>$null
        Write-Step "Sent git credential reject for $ForgejoHost" "ok"
    } else {
        Write-Step "git not available - skipping credential reject" "skip"
    }

    # Plaintext fallback
    $gitCreds = "$env:USERPROFILE\.git-credentials"
    if (Test-Path $gitCreds) {
        $lines = Get-Content $gitCreds | Where-Object { $_ -notmatch $ForgejoHost }
        $lines | Set-Content $gitCreds -Encoding UTF8
        Write-Step "Cleaned $ForgejoHost from .git-credentials" "ok"
    }
}

# -------------------------------------------------------------------------
# 5. Scaffolded project & test project dir
# -------------------------------------------------------------------------
Write-Host ""
Write-Host "--- Step 5: Test project & scaffolded project ---"

# Delete any reparse points (the scaffold links .claude/skills -> repo/skills as
# an NTFS junction) FIRST, so the recursive delete below never follows the link
# into repo/skills and clobbers the wrong tree.
if (Test-Path $Project) {
    $reparse = Get-ChildItem -Path $Project -Recurse -Force -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }
    foreach ($link in $reparse) {
        if ($DryRun) {
            Write-Step "junction/symlink $($link.FullName)" "dry"
        } else {
            try { $link.Delete() } catch { cmd /c rmdir "$($link.FullName)" 2>$null }
            Write-Step "Removed link $($link.FullName)" "ok"
        }
    }
}

Remove-DirSafe $Project "test project ($Project)"

# -------------------------------------------------------------------------
# 6. Optional: hide Node/Git (--full)
# -------------------------------------------------------------------------
if ($Full) {
    Write-Host ""
    Write-Host "--- Step 6: Hide Node & Git from PATH (-Full) ---"

    $shimDir = "$env:USERPROFILE\.guild-test-shims"

    if ($DryRun) {
        Write-Step "Would create shim dir at $shimDir" "dry"
        Write-Step "Would create node.cmd/git.cmd shims that exit 127" "dry"
    } else {
        New-Item -ItemType Directory -Force -Path $shimDir | Out-Null

        # Node shim
        @"
@echo off
echo node: command not found (guild-test shim) 1>&2
exit /b 127
"@ | Set-Content "$shimDir\node.cmd" -Encoding ASCII

        # Git shim
        @"
@echo off
echo git: command not found (guild-test shim) 1>&2
exit /b 127
"@ | Set-Content "$shimDir\git.cmd" -Encoding ASCII

        Write-Step "Created shims in $shimDir" "ok"
        Write-Host ""
        Write-Host "  To activate:   `$env:PATH = '$shimDir;' + `$env:PATH"
        Write-Host "  To deactivate: `$env:PATH = `$env:PATH.Replace('$shimDir;', '')"
        Write-Host "  To remove:     Remove-Item -Recurse $shimDir"
    }
}

# -------------------------------------------------------------------------
# Done
# -------------------------------------------------------------------------
Write-Host ""
if ($DryRun) {
    Write-Host "=== Dry run complete. No changes were made. ===" -ForegroundColor Cyan
} else {
    Write-Host "=== Reset complete. Ready for a fresh install. ===" -ForegroundColor Cyan
}
Write-Host ""
