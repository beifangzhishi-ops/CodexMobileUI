@echo off
setlocal EnableExtensions
chcp 65001 >nul
set "SHELL=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if exist "%LOCALAPPDATA%\Programs\PowerShell\7\pwsh.exe" set "SHELL=%LOCALAPPDATA%\Programs\PowerShell\7\pwsh.exe"
if not exist "%SHELL%" (
  echo PowerShell is required.
  exit /b 1
)
"%SHELL%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\mobile-launcher.ps1" -Action start
set "RESULT=%ERRORLEVEL%"
if not "%RESULT%"=="0" pause
exit /b %RESULT%
