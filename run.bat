@echo off
cd /d "%~dp0"
set "PATH=%USERPROFILE%\go\bin;%PATH%"

echo ===================================================
echo   Starting Ponta Drive (Backend and Frontend)
echo ===================================================

call bunx --bun concurrently -k -n "backend,frontend" -c "blue.bold,green.bold" "cd backend && air" "cd frontend && bun run dev"
set "EXITCODE=%errorlevel%"

echo.
if not "%EXITCODE%"=="0" (
  echo ===================================================
  echo   [ERROR] Process stopped with exit code %EXITCODE%.
  echo   Read the messages above to see what went wrong.
  echo ===================================================
) else (
  echo ===================================================
  echo   Process stopped normally.
  echo ===================================================
)

echo.
echo Press any key to close this window . . .
pause >nul
