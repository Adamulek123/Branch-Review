[CmdletBinding()]
param(
    [string]$CodexExecutable = "codex"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$supportedCodexVersion = [version]"0.145.0"
$fixtureNames = @(
    "ClientRequest.json"
    "ServerRequest.json"
    "ServerNotification.json"
    "CommandExecutionRequestApprovalResponse.json"
    "ToolRequestUserInputResponse.json"
)

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$fixtureRoot = Join-Path $repositoryRoot "app\src-tauri\tests\fixtures\codex-app-server\0.145"
$temporaryBase = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$temporaryRoot = Join-Path $temporaryBase (
    "branch-review-codex-schemas-{0}" -f [guid]::NewGuid().ToString("N")
)

$versionOutput = (& $CodexExecutable --version | Out-String).Trim()
if ($LASTEXITCODE -ne 0) {
    throw "Could not read the Codex CLI version."
}
if ($versionOutput -notmatch "codex-cli\s+(\d+)\.(\d+)\.(\d+)") {
    throw "Unexpected Codex CLI version output: $versionOutput"
}

$installedVersion = [version]::new(
    [int]$Matches[1],
    [int]$Matches[2],
    [int]$Matches[3]
)
if (
    $installedVersion.Major -ne $supportedCodexVersion.Major -or
    $installedVersion.Minor -ne $supportedCodexVersion.Minor
) {
    throw (
        "Codex CLI {0} cannot refresh schemas pinned to {1}.{2}.x." -f
        $installedVersion,
        $supportedCodexVersion.Major,
        $supportedCodexVersion.Minor
    )
}

try {
    $null = New-Item -ItemType Directory -Path $temporaryRoot
    $resolvedTemporaryRoot = (Resolve-Path -LiteralPath $temporaryRoot).Path
    if (
        -not $resolvedTemporaryRoot.StartsWith(
            $temporaryBase,
            [System.StringComparison]::OrdinalIgnoreCase
        ) -or
        (Split-Path -Leaf $resolvedTemporaryRoot) -notlike "branch-review-codex-schemas-*"
    ) {
        throw "Refusing to use an unexpected temporary schema directory."
    }

    & $CodexExecutable app-server generate-json-schema --out $resolvedTemporaryRoot
    if ($LASTEXITCODE -ne 0) {
        throw "Codex app-server schema generation failed."
    }

    $null = New-Item -ItemType Directory -Path $fixtureRoot -Force
    foreach ($name in $fixtureNames) {
        $source = Join-Path $resolvedTemporaryRoot $name
        if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
            throw "Codex did not generate the required fixture: $name"
        }
        Copy-Item -LiteralPath $source -Destination (Join-Path $fixtureRoot $name) -Force
    }

    Get-ChildItem -LiteralPath $fixtureRoot -File -Filter "*.json" |
        Where-Object { $fixtureNames -notcontains $_.Name } |
        Remove-Item -Force

    Write-Host (
        "Refreshed {0} Codex app-server fixtures from Codex CLI {1}." -f
        $fixtureNames.Count,
        $installedVersion
    )
}
finally {
    if (Test-Path -LiteralPath $temporaryRoot) {
        $resolvedTemporaryRoot = (Resolve-Path -LiteralPath $temporaryRoot).Path
        if (
            $resolvedTemporaryRoot.StartsWith(
                $temporaryBase,
                [System.StringComparison]::OrdinalIgnoreCase
            ) -and
            (Split-Path -Leaf $resolvedTemporaryRoot) -like "branch-review-codex-schemas-*"
        ) {
            Remove-Item -LiteralPath $resolvedTemporaryRoot -Recurse -Force
        }
    }
}
