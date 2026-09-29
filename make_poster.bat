@echo off
REM Double-click to render your family tree as a printable poster in Blender.
REM First, on the tree page open the ... menu and choose "Export for a Blender poster".
REM You can also drag a *-poster.json file onto this file.
cd /d "%~dp0"
REM Find Blender: on the PATH, the usual install folder, or Steam.
set "BLENDER="
for /f "delims=" %%B in ('where blender 2^>nul') do if not defined BLENDER set "BLENDER=%%B"
if not defined BLENDER for /d %%D in ("%ProgramFiles%\Blender Foundation\Blender*") do if exist "%%D\blender.exe" set "BLENDER=%%D\blender.exe"
if not defined BLENDER if exist "%ProgramFiles(x86)%\Steam\steamapps\common\Blender\blender.exe" set "BLENDER=%ProgramFiles(x86)%\Steam\steamapps\common\Blender\blender.exe"
if not defined BLENDER goto noblender
echo Using Blender: "%BLENDER%"
echo.
set "JSON=%~1"
if not defined JSON for /f "delims=" %%F in ('dir /b /o:d "%USERPROFILE%\Downloads\*-poster.json" 2^>nul') do set "JSON=%USERPROFILE%\Downloads\%%F"
if not defined JSON goto nojson
echo Making a poster from "%JSON%"
echo This takes a few minutes. The window will say when it is done.
echo.
"%BLENDER%" --background --python-exit-code 1 --python blender\render_poster.py -- "%JSON%"
if errorlevel 1 goto failed
echo.
echo Your poster is ready. Opening it now...
start "" "%JSON:.json=.png%"
pause
exit /b 0

:nojson
echo No poster file found in your Downloads folder.
echo On the tree page, open the ... menu, choose "Export for a Blender poster", then run this again.
pause
exit /b 1

:failed
echo.
echo Something went wrong. Copy the error lines above and send them to Claude.
pause
exit /b 1

:noblender
echo Kinroot couldn't find Blender.
echo Install it from https://www.blender.org/download/ using the normal installer,
echo then double-click this file again.
pause
exit /b 1
