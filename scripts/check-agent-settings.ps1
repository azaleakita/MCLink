param([string]$AppDirectory = 'dist/MCLink')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$taskRoot = Split-Path $PSScriptRoot -Parent
$env:MCLINK_DATA_DIR = Join-Path $taskRoot ('.tools/qa-agent-settings-' + [Guid]::NewGuid().ToString('N'))
$taskAppDirectory = if ([IO.Path]::IsPathRooted($AppDirectory)) { $AppDirectory } else { Join-Path $taskRoot $AppDirectory }
$taskExe = Join-Path $taskAppDirectory 'MCLink.App.exe'
$script:taskApp = $null
$script:taskWindow = $null

function Start-TestApp {
    $script:taskApp = Start-Process -FilePath $taskExe -WindowStyle Hidden -PassThru
    $match = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ProcessIdProperty, $script:taskApp.Id)
    for ($attempt = 0; $attempt -lt 80; $attempt++) {
        if ($script:taskApp.HasExited) { throw 'Test application exited before opening.' }
        $script:taskWindow = [Windows.Automation.AutomationElement]::RootElement.FindFirst([Windows.Automation.TreeScope]::Children, $match)
        if ($script:taskWindow) { Start-Sleep -Seconds 2; return }
        Start-Sleep -Milliseconds 250
    }
    throw 'Test window not found.'
}
function Close-TestApp {
    if ($script:taskApp -and !$script:taskApp.HasExited) {
        $script:taskApp.CloseMainWindow() | Out-Null
        if (!$script:taskApp.WaitForExit(5000)) { Stop-Process -Id $script:taskApp.Id -Force }
    }
}
function Control([string]$id) {
    $match = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::AutomationIdProperty, $id)
    $element = $script:taskWindow.FindFirst([Windows.Automation.TreeScope]::Descendants, $match)
    if (!$element) { throw "Missing control: $id" }
    return $element
}
function Page([string]$name) {
    $match = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::NameProperty, $name)
    $elements = $script:taskWindow.FindAll([Windows.Automation.TreeScope]::Descendants, $match)
    foreach ($element in $elements) {
        $pattern = $null
        if ($element.TryGetCurrentPattern([Windows.Automation.SelectionItemPattern]::Pattern, [ref]$pattern)) {
            $pattern.Select(); Start-Sleep -Milliseconds 300; return
        }
    }
    throw "Navigation missing: $name"
}
function Number-Edit([string]$id) {
    $match = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ControlTypeProperty, [Windows.Automation.ControlType]::Edit)
    return (Control $id).FindFirst([Windows.Automation.TreeScope]::Descendants, $match)
}
function Number-Value([string]$id) { return (Number-Edit $id).GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern).Current.Value }
function Set-Text([string]$id, [string]$value) { (Control $id).GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern).SetValue($value) }
function Read-TestSettings {
    $bytes = [IO.File]::ReadAllBytes((Join-Path $env:MCLINK_DATA_DIR 'settings.bin'))
    $plain = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    try { return [Text.Encoding]::UTF8.GetString($plain) | ConvertFrom-Json }
    finally { [Security.Cryptography.CryptographicOperations]::ZeroMemory($plain) }
}
try {
    Start-TestApp
    Page '运行设置'
    if ((Number-Value 'BatchSizeBox') -ne '4') { throw 'Batch default is not 4.' }
    $batchEdit = Number-Edit 'BatchSizeBox'
    $batchEdit.SetFocus(); $batchEdit.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern).SetValue('6')
    Start-Sleep -Milliseconds 200
    $match = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::NameProperty, '保存设置')
    $save = $script:taskWindow.FindFirst([Windows.Automation.TreeScope]::Descendants, $match)
    $save.SetFocus(); Start-Sleep -Milliseconds 200; $save.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
    Start-Sleep -Milliseconds 500
    if ((Read-TestSettings).preferences.batchSize -ne 6) {
        Write-Output ('NumberBox patterns: ' + ((Control 'BatchSizeBox').GetSupportedPatterns().ProgrammaticName -join ', '))
        Write-Output ('Edit text: ' + (Number-Value 'BatchSizeBox'))
        Write-Output ('Saved batch: ' + (Read-TestSettings).preferences.batchSize)
        throw 'Batch setting was not persisted.'
    }
    Page '模型与 API'
    (Control 'ApiAdvancedExpander').GetCurrentPattern([Windows.Automation.ExpandCollapsePattern]::Pattern).Expand()
    Start-Sleep -Milliseconds 200
    if ((Number-Value 'RequestIntervalBox') -ne '8') { throw 'API interval default is not 8.' }
    Set-Text 'ProfileNameBox' 'QA interval'
    Set-Text 'BaseUrlBox' 'http://127.0.0.1:9/v1'
    Set-Text 'ModelBox' 'qa-model'
    $intervalEdit = Number-Edit 'RequestIntervalBox'
    $intervalEdit.SetFocus(); $intervalEdit.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern).SetValue('12')
    Start-Sleep -Milliseconds 200
    $save = Control 'SaveProfileButton'
    $save.SetFocus(); Start-Sleep -Milliseconds 200; $save.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
    Start-Sleep -Milliseconds 500
    if ((Read-TestSettings).profiles[0].requestIntervalSeconds -ne 12) { throw 'API interval was not persisted.' }
    Close-TestApp
    Start-TestApp
    Page '运行设置'
    if ((Number-Value 'BatchSizeBox') -ne '6') { throw 'Batch setting was not restored.' }
    Page '模型与 API'
    (Control 'ApiAdvancedExpander').GetCurrentPattern([Windows.Automation.ExpandCollapsePattern]::Pattern).Expand()
    if ((Number-Value 'RequestIntervalBox') -ne '12') { throw 'API interval was not restored.' }
    Write-Output 'PASS: Native WinUI defaults, setting edits, DPAPI persistence and restart restore.'
    Write-Output 'PASS: Isolated data directory; no user API calls or settings changes.'
} finally { Close-TestApp }
