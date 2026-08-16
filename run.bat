@echo off
title Folder & File Size Scanner
echo ============================================
echo   Folder ^& File Size Scanner
echo ============================================
echo.

:: Check if frontend is built
if not exist "backend\wwwroot\index.html" (
    echo Building frontend for first run...
    echo.
    cd frontend
    if not exist "node_modules" (
        echo Installing dependencies...
        call npm install
        if errorlevel 1 (
            echo ERROR: Failed to install dependencies.
            pause
            exit /b 1
        )
    )
    echo Compiling frontend...
    call npm run build
    if errorlevel 1 (
        echo ERROR: Failed to build frontend.
        pause
        exit /b 1
    )
    cd ..
    echo.
    echo Frontend built successfully.
    echo.
)

echo Starting scanner...
echo Opening browser at http://localhost:5000
echo Press Ctrl+C to stop.
echo.

cd backend
dotnet run --launch-profile FolderFileSizeScanner
