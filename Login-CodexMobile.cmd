@echo off
setlocal EnableExtensions
chcp 65001 >nul
set "SHELL=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if exist "%LOCALAPPDATA%\Programs\PowerShell\7\pwsh.exe" set "SHELL=%LOCALAPPDATA%\Programs\PowerShell\7\pwsh.exe"
"%SHELL%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\mobile-app-server.ps1" -Action login
set "RESULT=%ERRORLEVEL%"
if not "%RESULT%"=="0" pause
exit /b %RESULT%
