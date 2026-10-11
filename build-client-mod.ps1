param([string]$JdkDirectory = '', [string]$OutputDirectory = 'dist/MCLink/client-mod')
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$projectRoot = $PSScriptRoot
if (!$JdkDirectory) { $JdkDirectory = $env:JAVA_HOME }
if (!$JdkDirectory -or !(Test-Path -LiteralPath (Join-Path $JdkDirectory 'bin/javac.exe'))) {
    $compiler = Get-Command javac.exe -ErrorAction SilentlyContinue
    if ($compiler) { $JdkDirectory = Split-Path (Split-Path $compiler.Source) }
    else {
        $runtimeRoot = Join-Path $env:APPDATA '.minecraft/runtime'
        $compiler = Get-ChildItem -LiteralPath $runtimeRoot -Filter javac.exe -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match 'jdk-21' } | Select-Object -First 1
        if ($compiler) { $JdkDirectory = Split-Path (Split-Path $compiler.FullName) }
    }
}
if (!$JdkDirectory) { throw 'Install Java 21 JDK or pass -JdkDirectory.' }
$compilerVersion = (& (Join-Path $JdkDirectory 'bin/javac.exe') -version 2>&1) -join ''
if ($compilerVersion -notmatch '^javac 21\.') { throw 'This mod requires Java 21 JDK.' }
$env:JAVA_HOME = $JdkDirectory
$env:GRADLE_USER_HOME = Join-Path $projectRoot '.tools/gradle-cache'
$gradleDirectory = Join-Path $projectRoot '.tools/gradle'
$gradleExecutable = Join-Path $gradleDirectory 'gradle-9.2.1/bin/gradle.bat'
if (!(Test-Path -LiteralPath $gradleExecutable)) {
    New-Item -ItemType Directory -Path $gradleDirectory -Force | Out-Null
    $archive = Join-Path $gradleDirectory 'gradle-9.2.1-bin.zip'
    Invoke-WebRequest 'https://services.gradle.org/distributions/gradle-9.2.1-bin.zip' -OutFile $archive
    $expectedHash = (Invoke-RestMethod 'https://services.gradle.org/distributions/gradle-9.2.1-bin.zip.sha256').Trim()
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedHash) { throw 'Gradle checksum mismatch.' }
    Expand-Archive -LiteralPath $archive -DestinationPath $gradleDirectory -Force
}
& $gradleExecutable -p (Join-Path $projectRoot 'client-mod') --no-daemon --console=plain build
if ($LASTEXITCODE -ne 0) { throw 'Client mod build failed.' }
$outputDirectory = if ([IO.Path]::IsPathRooted($OutputDirectory)) { $OutputDirectory } else { Join-Path $projectRoot $OutputDirectory }
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot 'client-mod/build/libs/mclink-chat-1.21.11-0.4.0.jar') -Destination $outputDirectory -Force
$dependencyDirectory = Join-Path $projectRoot '.tools/client-mod-deps'
New-Item -ItemType Directory -Force -Path $dependencyDirectory | Out-Null
$fabricApi = Join-Path $dependencyDirectory 'fabric-api-0.141.6+1.21.11.jar'
$apiHash = (Invoke-RestMethod 'https://maven.fabricmc.net/net/fabricmc/fabric-api/fabric-api/0.141.6+1.21.11/fabric-api-0.141.6+1.21.11.jar.sha256').Trim()
if (!(Test-Path -LiteralPath $fabricApi) -or (Get-FileHash -LiteralPath $fabricApi -Algorithm SHA256).Hash.ToLowerInvariant() -ne $apiHash) {
    Invoke-WebRequest 'https://maven.fabricmc.net/net/fabricmc/fabric-api/fabric-api/0.141.6+1.21.11/fabric-api-0.141.6+1.21.11.jar' -OutFile $fabricApi
}
if ((Get-FileHash -LiteralPath $fabricApi -Algorithm SHA256).Hash.ToLowerInvariant() -ne $apiHash) { throw 'Fabric API checksum mismatch.' }
Copy-Item -LiteralPath $fabricApi -Destination $outputDirectory -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'client-mod/README.md') -Destination $outputDirectory -Force
Write-Output "Ready: $outputDirectory"
