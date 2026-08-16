# Folder & File Size Scanner

A local web application that scans drives and folders on Windows, showing the largest files, directory size breakdowns, and cleanup suggestions. Built with a .NET backend (SSE streaming) and a React + Vite frontend.

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

## Features

### Drive & Folder Scanning
- Select any drive or enter a custom folder path to scan
- Real-time progress with file/directory counts, total size, and estimated completion percentage
- Streams results via Server-Sent Events — no polling

### Directory Browser
- Navigate the scanned directory tree with clickable breadcrumbs
- Each directory shows a size bar proportional to its parent, total size in GB, and file count
- Directories are sorted largest-first so you can immediately see where space is used
- Files within each directory are shown below with their own size bars

### Largest Files
- Top 100 files sorted by size with path, extension, and last-modified date

### Cleanup Suggestions
- Known cache and temp directories (npm, NuGet, browser caches, Windows temp, Recycle Bin, etc.)
- File types that are often safe to remove (`.tmp`, `.log`, `.bak`, `.dmp`, `.old`)
- All suggestions are informational — the app never modifies files

### Scan History & Caching
- Every scan is automatically cached to `%LocalAppData%\FolderFileSizeScanner\cache`
- Load previous scans from the History panel to browse results without rescanning
- Compare how disk usage changes over time
- Cache auto-prunes to the 20 most recent scans

### Dark / Light Mode
- Three-way toggle: Light, Dark, or System (follows device theme)
- Preference is saved to localStorage and remembered across sessions

## Project Structure

```
backend/              .NET 10 minimal API
  Program.cs          Entry point, API endpoints (drives, scan, browse, cache)
  ScannerService.cs   File-tree walker, directory size aggregation, caching
  Models.cs           Shared record types
frontend/             React + TypeScript + Vite
  src/App.tsx         UI: drive selection, scan progress, results, directory browser
  src/api.ts          API client (SSE for scan, REST for browse/cache)
  src/types.ts        TypeScript interfaces matching backend models
  src/App.css         Full dark/light theme with CSS custom properties
backend.Tests/        xUnit unit + integration tests (42 tests)
frontend/src/utils.test.ts  Vitest unit tests for utilities (28 tests)
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/drives` | List ready drives with usage stats |
| GET | `/api/scan?path=...` | SSE stream: scan a path (progress, logs, result) |
| GET | `/api/browse?path=...` | Browse directory from last scan's cached data |
| GET | `/api/cache` | List cached scan summaries |
| GET | `/api/cache/{id}` | Get full cached scan detail |
| POST | `/api/cache/{id}/load` | Load cached scan into memory for browsing |
| DELETE | `/api/cache/{id}` | Delete a cached scan |

## Running Tests

```
cd backend.Tests
dotnet test

cd ../frontend
npm test
```

## Notes

- The scanner skips reparse points (symlinks, junctions) to avoid infinite loops.
- Access-denied errors are counted and summarized rather than failing the scan.
- Scanning a drive root shows an estimated percentage based on used disk space.
- Only one scan runs at a time; the app enforces single-instance via a global mutex.
