@echo off
setlocal
set "PROJECT=%~dp0"
set "ADB=%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe"
if not exist "%PROJECT%node_modules\expo\package.json" (
  echo CodexMobile visual dependencies are missing.
  pause
  exit /b 1
)
if exist "%ADB%" (
  "%ADB%" -s emulator-5554 reverse tcp:8081 tcp:8081
  "%ADB%" -s emulator-5554 reverse tcp:49173 tcp:49173
)
"%SystemRoot%\System32\curl.exe" --silent --max-time 2 "http://127.0.0.1:49173/health" >nul 2>&1
if errorlevel 1 (
  start "CodexMobile Visual Editor" /D "%PROJECT%" "%ComSpec%" /k "node.exe scripts\visual-editor.mjs"
)
"%SystemRoot%\System32\curl.exe" --silent --max-time 2 "http://127.0.0.1:8081/status" >nul 2>&1
if errorlevel 1 (
  start "CodexMobile Metro" /D "%PROJECT%" "%ComSpec%" /k "npm.cmd run dev -- --port 8081"
)
timeout /t 3 /nobreak >nul
start "" "http://127.0.0.1:49173/"
echo CodexMobile visual editor and Metro started.
echo Close their console windows to stop the services.
exit /b 0
