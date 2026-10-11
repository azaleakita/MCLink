param(
    [string]$AppDirectory = 'dist/MCLink',
    [string]$OutputDirectory = 'dist/releases',
    [string]$Version = '',
    [switch]$RequireClientMod
)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path $PSScriptRoot -Parent
$taskAppDirectory = if ([IO.Path]::IsPathRooted($AppDirectory)) { $AppDirectory } else { Join-Path $taskRoot $AppDirectory }
$taskAppDirectory = [IO.Path]::GetFullPath($taskAppDirectory)
$taskOutputDirectory = if ([IO.Path]::IsPathRooted($OutputDirectory)) { $OutputDirectory } else { Join-Path $taskRoot $OutputDirectory }
[xml]$taskProject = Get-Content -LiteralPath (Join-Path $taskRoot 'src/MCLink.App/MCLink.App.csproj') -Raw
$taskSourceVersion = [string]$taskProject.Project.PropertyGroup.Version
if (!$Version) { $Version = $taskSourceVersion }
if ($Version -notmatch '^\d+\.\d+\.\d+$' -or $Version -ne $taskSourceVersion) { throw 'Release version must match the application source version.' }
$taskBridge = Get-Content -LiteralPath (Join-Path $taskAppDirectory 'bridge/package.json') -Raw | ConvertFrom-Json
if ($taskBridge.version -ne $Version) { throw 'Packaged bridge version does not match the release.' }
$taskExe = Get-Item -LiteralPath (Join-Path $taskAppDirectory 'MCLink.App.exe')
if ($taskExe.VersionInfo.FileVersion -ne "$Version.0") { throw 'Application executable version does not match the release.' }
$taskRequired = @(
    'MCLink.App.exe', 'MCLink.App.dll', 'MCLink.App.runtimeconfig.json',
    'Microsoft.WindowsAppRuntime.Bootstrap.dll', 'coreclr.dll',
    'runtime/node.exe', 'bridge/src/server.mjs', 'bridge/src/request-scheduler.mjs',
    'bridge/node_modules/mineflayer/package.json', 'bridge/node_modules/mineflayer-pathfinder/package.json',
    'Assets/icon-manifest.json', 'LICENSES/Node-LICENSE.txt', 'LICENSES/DotNet-LICENSE.txt',
    'LICENSES/WindowsAppSDK-LICENSE.txt', 'README.md', 'THIRD-PARTY-NOTICES.md', 'VERIFICATION.md', 'ASSET-SOURCES.md'
)
if ($RequireClientMod) {
    $taskRequired += 'client-mod/mclink-chat-1.21.11-0.4.0.jar', 'client-mod/fabric-api-0.141.6+1.21.11.jar', 'client-mod/README.md'
}
foreach ($taskRelative in $taskRequired) {
    if (!(Test-Path -LiteralPath (Join-Path $taskAppDirectory $taskRelative) -PathType Leaf)) { throw "Missing release file: $taskRelative" }
}
$taskForbidden = Get-ChildItem -LiteralPath $taskAppDirectory -Recurse -File -Force | Where-Object {
    $_.Name -eq 'settings.bin' -or $_.Name -like '.env*' -or $_.Extension -in '.log', '.pfx', '.p12' -or
    $_.FullName.Substring($taskAppDirectory.Length).Replace('\', '/') -match '/(auth|logs|\.tools|\.git)/'
}
if ($taskForbidden) { throw 'The release directory contains local settings, credentials, logs or build data.' }
New-Item -ItemType Directory -Path $taskOutputDirectory -Force | Out-Null
$taskArchive = Join-Path $taskOutputDirectory "MCLink-$Version-win-x64.zip"
if (Test-Path -LiteralPath $taskArchive) { throw 'Release archive already exists; use a new output directory to avoid replacing an artifact.' }
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$taskZip = [IO.Compression.ZipFile]::Open($taskArchive, [IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($taskFile in (Get-ChildItem -LiteralPath $taskAppDirectory -Recurse -File -Force | Sort-Object FullName)) {
        if ($taskFile.Extension -eq '.pdb') { continue }
        $taskRelative = $taskFile.FullName.Substring($taskAppDirectory.Length).TrimStart('\', '/').Replace('\', '/')
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($taskZip, $taskFile.FullName, "MCLink/$taskRelative", [IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
} finally { $taskZip.Dispose() }
$taskZip = [IO.Compression.ZipFile]::OpenRead($taskArchive)
try {
    foreach ($taskRelative in $taskRequired) {
        if (!$taskZip.GetEntry("MCLink/$taskRelative")) { throw "Archive missing file: $taskRelative" }
    }
    if ($taskZip.Entries | Where-Object { !$_.FullName.StartsWith('MCLink/') }) { throw 'Unexpected archive root.' }
    Write-Output "Validated $($taskZip.Entries.Count) archive entries."
} finally { $taskZip.Dispose() }
$taskHash = (Get-FileHash -LiteralPath $taskArchive -Algorithm SHA256).Hash.ToLowerInvariant()
$taskChecksum = Join-Path $taskOutputDirectory "MCLink-$Version-win-x64.sha256"
[IO.File]::WriteAllText($taskChecksum, "$taskHash  $([IO.Path]::GetFileName($taskArchive))`n", [Text.UTF8Encoding]::new($false))
Write-Output "Ready: $taskArchive"
Write-Output "SHA256: $taskHash"
