@echo off
if exist "%~dp0dist\MCLink\MCLink.App.exe" (
  start "" "%~dp0dist\MCLink\MCLink.App.exe"
) else (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0build.ps1" -Run
  if errorlevel 1 pause
)
