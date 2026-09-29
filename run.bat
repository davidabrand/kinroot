@echo off
REM Double-click to start Kinroot. The first run sets everything up (about a minute).
cd /d "%~dp0"
where python >nul 2>nul
if errorlevel 1 (
  echo.
  echo Kinroot needs Python. Install it from https://www.python.org/downloads/
  echo and tick "Add python.exe to PATH" during setup, then double-click run.bat again.
  pause
  exit /b 1
)
if not exist .venv (
  echo Setting up Kinroot for the first time...
  python -m venv .venv
  call .venv\Scripts\activate
  python -m pip install --quiet --upgrade pip
  pip install --quiet -r requirements.txt
) else (
  call .venv\Scripts\activate
)
REM Open the browser a few seconds after the server starts.
start "" cmd /c "timeout /t 3 >nul & start http://127.0.0.1:5000"
python app.py
pause
