@echo off
title Folder & File Size Scanner - Dev Mode
echo ============================================
echo   Dev Mode (hot-reload frontend)
echo ============================================
echo.
echo Starting .NET backend on :5000
echo Starting Vite dev server on :5173
echo.

:: Install frontend deps if needed
cd frontend
if not exist "node_modules" (
    echo Installing frontend dependencies...
    call npm install
)
cd ..

:: Start backend in background
start "Scanner Backend" cmd /c "cd backend && dotnet run --launch-profile Development"

:: Start frontend dev server
cd frontend
echo Waiting for backend to start...
timeout /t 3 /nobreak >nul
echo Opening http://localhost:5173
start http://localhost:5173
call npm run dev
