# Folder & File Size Scanner

A local web application that scans drives and folders on Windows, showing the largest files and suggesting directories to clean up. Built with a .NET backend (SSE streaming) and a React + Vite frontend.

## Prerequisites

- [.NET 10 SDK](https://dotnet.microsoft.com/download/dotnet/10.0)
- [Node.js](https://nodejs.org/) (v18+)

## Quick Start

**Option 1 — One command:**

```
run.bat
```

This installs frontend dependencies (if needed), builds the frontend, starts the backend on `http://localhost:5000`, and opens the app in your browser.

**Option 2 — Development mode (hot reload):**

```
dev.bat
```

Starts the .NET backend on `:5000` and the Vite dev server on `:5173` with hot module replacement. Frontend changes appear instantly without rebuilding.

## Publishing a Standalone Executable

```
publish.bat
```

Produces a self-contained `publish/FolderFileSizeScanner.exe` that runs without requiring .NET or Node.js installed. Double-click to launch.

## How It Works

1. **Drive selection** — The home screen lists all ready drives with usage bars. You can also type any folder path.
2. **Real-time scanning** — The backend walks the file tree using `EnumerateFileSystemInfos` (one syscall per directory entry) and streams progress, log entries, and results via Server-Sent Events.
3. **Results** — Three tabs:
   - **Largest Files** — Top 100 files sorted by size, with path, extension, and last-modified date.
   - **Cleanup Suggestions** — Known cache/temp directories (npm, NuGet, browser caches, Windows temp, etc.) and file types (`.tmp`, `.log`, `.bak`, `.dmp`, `.old`) with total sizes.
   - **Scan Log** — Timestamped log with filterable info/warning/error levels.

Only one scan runs at a time. The app enforces single-instance via a global mutex.

## Project Structure

```
backend/              .NET 10 minimal API
  Program.cs          Entry point, API endpoints, SSE streaming
  ScannerService.cs   File-tree walker with progress reporting
  Models.cs           Shared record types
frontend/             React + TypeScript + Vite
  src/App.tsx         Main UI (drive selection, scan progress, results)
  src/api.ts          SSE client for /api/scan
  src/types.ts        TypeScript interfaces matching backend models
backend.Tests/        xUnit integration and unit tests
```

## Running Tests

```
cd backend.Tests
dotnet test
```

## Notes

- The scanner skips reparse points (symlinks, junctions) to avoid infinite loops.
- Access-denied errors are counted and summarized rather than failing the scan.
- Scanning a drive root shows an estimated percentage based on used disk space.
- The app does **not** modify or delete any files — suggestions are informational only.
