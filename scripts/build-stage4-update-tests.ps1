$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$packagePath = Join-Path $root "package.json"
$originalPackageJson = [System.IO.File]::ReadAllText($packagePath)
$oldName = $env:DAGUAN_SQUIRREL_NAME
$oldSetup = $env:DAGUAN_SQUIRREL_SETUP_EXE
$outRoot = Join-Path $root ".build\stage4-update-qa"
$env:DAGUAN_SQUIRREL_NAME = "DaguanMathStage4QA"
$env:DAGUAN_SQUIRREL_SETUP_EXE = "DaguanMathStage4QA-Setup.exe"

try {
    New-Item -ItemType Directory -Force -Path $outRoot | Out-Null
    foreach ($version in @("0.9.0", "0.9.1")) {
        $package = $originalPackageJson | ConvertFrom-Json
        $package.version = $version
        $json = $package | ConvertTo-Json -Depth 100
        [System.IO.File]::WriteAllText($packagePath, $json + "`n", [System.Text.UTF8Encoding]::new($false))

        Push-Location $root
        try {
            & npm.cmd run package:desktop:windows
            if ($LASTEXITCODE -ne 0) { throw "Forge packaging failed for $version with exit code $LASTEXITCODE" }
        } finally { Pop-Location }

        $source = Join-Path $root "out\make\squirrel.windows\x64"
        $destination = Join-Path $outRoot $version
        New-Item -ItemType Directory -Force -Path $destination | Out-Null
        Copy-Item -LiteralPath (Join-Path $source "RELEASES") -Destination $destination -Force
        Copy-Item -LiteralPath (Join-Path $source "DaguanMathStage4QA-$version-full.nupkg") -Destination $destination -Force
        Copy-Item -LiteralPath (Join-Path $source "DaguanMathStage4QA-Setup.exe") -Destination $destination -Force
        Write-Output "Built isolated Squirrel QA version $version at $destination"
    }
} finally {
    [System.IO.File]::WriteAllText($packagePath, $originalPackageJson, [System.Text.UTF8Encoding]::new($false))
    if ($null -eq $oldName) { Remove-Item Env:DAGUAN_SQUIRREL_NAME -ErrorAction SilentlyContinue } else { $env:DAGUAN_SQUIRREL_NAME = $oldName }
    if ($null -eq $oldSetup) { Remove-Item Env:DAGUAN_SQUIRREL_SETUP_EXE -ErrorAction SilentlyContinue } else { $env:DAGUAN_SQUIRREL_SETUP_EXE = $oldSetup }
}
