@echo off
rem Installs cuedo for this Windows user, starts it at login and opens it.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install.ps1"
if errorlevel 1 (echo. & echo Installation failed. See the message above. & pause & exit /b 1)
timeout /t 8 >nul
