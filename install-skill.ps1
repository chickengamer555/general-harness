# Install (or refresh) the global /general-harness skill.
#
# Copies skills\general-harness into ~\.claude\skills so the slash command works in
# every project, not just this repo. Re-run it after editing SKILL.md - the copy
# does not track the repo.
#
# The repo's SKILL.md is portable: it refers to the kernel as <kernel>. This
# script substitutes the real clone path into the INSTALLED copy, so the commands
# in the skill are runnable as written without hardcoding one machine's layout
# into a public repository.
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

# Point the installed copy at this clone. Forward slashes: Node accepts them on
# Windows, and they survive being pasted into any shell.
$root  = $PSScriptRoot.Replace('\', '/')
$skill = Join-Path $dst 'SKILL.md'

if ($root -match ' ') {
  Write-Warning "clone path contains a space ($root) - quote the path when running the commands in the skill."
}

$text = [System.IO.File]::ReadAllText($skill)
$text = $text.Replace('<kernel>', $root)
# Write UTF-8 with NO byte-order mark: a BOM ahead of the frontmatter's --- stops
# the skill being parsed.
[System.IO.File]::WriteAllText($skill, $text, (New-Object System.Text.UTF8Encoding($false)))

if ((Get-Content $skill -Raw) -match '<kernel>') { throw "substitution failed: <kernel> still present in $skill" }

Write-Output "installed: $dst"
Write-Output "kernel path baked in: $root"
Write-Output "The /general-harness skill is now available in every project. Restart Claude Code to pick it up."
