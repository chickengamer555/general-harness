# Install (or refresh) the global /general-harness skill.
#
# Copies skills\general-harness into ~\.claude\skills so the slash command works in
# every project, not just this repo. Re-run it after editing SKILL.md - the copy
# does not track the repo.
#
#   powershell -ExecutionPolicy Bypass -File install-skill.ps1

$ErrorActionPreference = 'Stop'
$src     = Join-Path $PSScriptRoot 'skills\general-harness'
$dstRoot = Join-Path $HOME '.claude\skills'
$dst     = Join-Path $dstRoot 'general-harness'

if (-not (Test-Path $src)) { throw "source skill not found: $src" }
if (-not (Test-Path $dstRoot)) { New-Item -ItemType Directory -Force $dstRoot | Out-Null }
if (Test-Path $dst) { Remove-Item -Recurse -Force $dst }

Copy-Item -Recurse $src $dst
Write-Output "installed: $dst"
Write-Output "The /general-harness skill is now available in every project. Restart Claude Code to pick it up."
