@echo off
REM Double-click to build the 3D models (medallion, trunk, leaves) in Blender for the tree page.
cd /d "%~dp0"
REM Find Blender: on the PATH, the usual install folder, or Steam.
set "BLENDER="
for /f "delims=" %%B in ('where blender 2^>nul') do if not defined BLENDER set "BLENDER=%%B"
if not defined BLENDER for /d %%D in ("%ProgramFiles%\Blender Foundation\Blender*") do if exist "%%D\blender.exe" set "BLENDER=%%D\blender.exe"
if not defined BLENDER if exist "%ProgramFiles(x86)%\Steam\steamapps\common\Blender\blender.exe" set "BLENDER=%ProgramFiles(x86)%\Steam\steamapps\common\Blender\blender.exe"
if not defined BLENDER goto noblender
echo Using Blender: "%BLENDER%"
echo.
echo Building the 3D models... this takes under a minute.
"%BLENDER%" --background --python-exit-code 1 --python blender\build_assets.py
if errorlevel 1 goto failed
echo.
echo Done. Refresh the tree page in your browser to see the Blender models.
pause
exit /b 0

:failed
echo.
echo Something went wrong. Copy the red or error lines above and send them to Claude.
pause
exit /b 1

:noblender
echo Kinroot couldn't find Blender.
echo Install it from https://www.blender.org/download/ using the normal installer,
echo then double-click this file again.
pause
exit /b 1
