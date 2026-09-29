@echo off
REM Double-click to add the demo family (log in as demo@example.com / password123).
cd /d "%~dp0"
if not exist .venv (
  echo Double-click run.bat once first, so Kinroot can set itself up.
  pause
  exit /b 1
)
call .venv\Scripts\activate
python seed_demo.py
pause
