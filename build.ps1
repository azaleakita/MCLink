param([switch]$Run, [switch]$SkipTests, [switch]$BuildClientMod, [string]$OutputDirectory = 'dist/MCLink')
$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$env:DOTNET_SKIP_FIRST_TIME_EXPERIENCE = '1'
$env:DOTNET_CLI_HOME = Join-Path $projectRoot '.tools\cli'
$env:NUGET_PACKAGES = Join-Path $projectRoot '.tools\nuget'
$dotnetExe = Join-Path $projectRoot '.tools\dotnet\dotnet.exe'
if (!(Test-Path -LiteralPath $dotnetExe)) {
    $installedDotnet = Get-Command dotnet.exe -ErrorAction SilentlyContinue
    if ($installedDotnet -and ((& $installedDotnet.Source --list-sdks) -match '^8\.')) { $dotnetExe = $installedDotnet.Source }
    else {
        Write-Host 'Downloading official .NET 8 SDK into .tools...'
        New-Item -ItemType Directory -Force -Path '.tools' | Out-Null
        Invoke-WebRequest 'https://dot.net/v1/dotnet-install.ps1' -OutFile '.tools\dotnet-install.ps1'
        & '.\.tools\dotnet-install.ps1' -Channel 8.0 -InstallDir (Join-Path $projectRoot '.tools\dotnet') -NoPath
        if ($LASTEXITCODE -ne 0) { throw '.NET SDK installation failed.' }
    }
}
$nodeExe = (Get-Command node.exe -ErrorAction Stop).Source
if ([int]((& $nodeExe --version).TrimStart('v').Split('.')[0]) -lt 22) { throw 'Node.js 22 or later is required.' }
Push-Location 'bridge'
try {
    & npm.cmd ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
    & npm.cmd run check
    if ($LASTEXITCODE -ne 0) { throw 'JavaScript syntax check failed.' }
    if (!$SkipTests) {
        & npm.cmd test
        if ($LASTEXITCODE -ne 0) { throw 'Bridge tests failed.' }
    }
} finally { Pop-Location }
$outputDirectory = if ([IO.Path]::IsPathRooted($OutputDirectory)) { $OutputDirectory } else { Join-Path $projectRoot $OutputDirectory }
& $dotnetExe publish 'src\MCLink.App\MCLink.App.csproj' -c Release -p:Platform=x64 -o $outputDirectory -v:minimal
if ($LASTEXITCODE -ne 0) { throw 'WinUI publish failed.' }
New-Item -ItemType Directory -Force -Path (Join-Path $outputDirectory 'runtime') | Out-Null
Copy-Item -LiteralPath $nodeExe -Destination (Join-Path $outputDirectory 'runtime\node.exe') -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'bridge\node_modules') -Destination (Join-Path $outputDirectory 'bridge') -Recurse -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'README.md') -Destination $outputDirectory -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'LICENSES') -Destination $outputDirectory -Recurse -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'THIRD-PARTY-NOTICES.md') -Destination $outputDirectory -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'VERIFICATION.md') -Destination $outputDirectory -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'ASSET-SOURCES.md') -Destination $outputDirectory -Force
if ($BuildClientMod) { & (Join-Path $projectRoot 'build-client-mod.ps1') -OutputDirectory (Join-Path $outputDirectory 'client-mod') }
elseif ((Test-Path -LiteralPath (Join-Path $projectRoot 'client-mod/build/libs/mclink-chat-1.21.11-0.4.0.jar')) -and
        (Test-Path -LiteralPath (Join-Path $projectRoot '.tools/client-mod-deps/fabric-api-0.141.6+1.21.11.jar'))) {
    $clientModOutput = Join-Path $outputDirectory 'client-mod'
    New-Item -ItemType Directory -Force -Path $clientModOutput | Out-Null
    Copy-Item -LiteralPath (Join-Path $projectRoot 'client-mod/build/libs/mclink-chat-1.21.11-0.4.0.jar') -Destination $clientModOutput -Force
    Copy-Item -LiteralPath (Join-Path $projectRoot 'client-mod/README.md') -Destination $clientModOutput -Force
    Copy-Item -LiteralPath (Join-Path $projectRoot '.tools/client-mod-deps/fabric-api-0.141.6+1.21.11.jar') -Destination $clientModOutput -Force
}
Write-Host "Ready: $outputDirectory\MCLink.App.exe"
if ($Run) { Start-Process -FilePath (Join-Path $outputDirectory 'MCLink.App.exe') -WindowStyle Hidden }
