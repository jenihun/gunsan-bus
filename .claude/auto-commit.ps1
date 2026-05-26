param()
$ErrorActionPreference = 'SilentlyContinue'

$raw = ''
try {
    while ($null -ne ($line = [Console]::In.ReadLine())) {
        $raw += $line
    }
} catch {}

if (-not $raw) { exit 0 }

try { $json = $raw | ConvertFrom-Json } catch { exit 0 }

$f = $json.tool_input.file_path
if (-not $f) { exit 0 }
if (-not (Test-Path $f)) { exit 0 }

$repo = git -C (Split-Path $f) rev-parse --show-toplevel 2>$null
if (-not $repo) { exit 0 }

git -C $repo add $f
$staged = git -C $repo diff --cached --name-only
if ($staged) {
    $name = Split-Path $f -Leaf
    git -C $repo commit -m "auto: $name"
}
