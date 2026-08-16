@echo off
title Publishing Folder & File Size Scanner
echo ============================================
echo   Publishing Standalone Executable
echo ============================================
echo.

:: Build frontend
echo [1/3] Building frontend...
cd frontend
if not exist "node_modules" (
    call npm install
    if errorlevel 1 (
        echo ERROR: Failed to install dependencies.
        pause
        exit /b 1
    )
)
call npm run build
if errorlevel 1 (
    echo ERROR: Failed to build frontend.
    pause
    exit /b 1
)
cd ..
echo.

:: Publish .NET app as self-contained single file
echo [2/3] Publishing .NET application...
cd backend
dotnet publish -c Release -r win-x64 --self-contained -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o ..\publish
if errorlevel 1 (
    echo ERROR: Failed to publish.
    pause
    exit /b 1
)
cd ..
echo.

:: Copy wwwroot to publish directory
echo [3/3] Copying frontend assets...
if not exist "publish\wwwroot" mkdir "publish\wwwroot"
xcopy /s /y "backend\wwwroot\*" "publish\wwwroot\" >nul
echo.

echo ============================================
echo   Build complete!
echo   Executable: publish\FolderFileSizeScanner.exe
echo   Double-click to run.
echo ============================================
pause
