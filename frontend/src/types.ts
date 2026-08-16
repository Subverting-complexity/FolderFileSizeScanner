export interface DriveInfo {
  letter: string;
  name: string;
  driveType: string;
  totalSize: number;
  freeSpace: number;
  isReady: boolean;
}

export interface FileEntry {
  path: string;
  size: number;
  extension: string;
  lastModified: string;
}

export interface ScanProgress {
  scannedFiles: number;
  scannedDirs: number;
  totalSize: number;
  currentDir: string;
  elapsedSeconds: number;
  percentComplete: number | null;
}

export interface SuggestionEntry {
  category: string;
  description: string;
  path: string;
  totalSize: number;
  fileCount: number;
}

export interface ScanResult {
  totalFiles: number;
  totalDirs: number;
  totalSize: number;
  elapsedSeconds: number;
  scanSpeedGBPerSec: number | null;
  largestFiles: FileEntry[];
  suggestions: SuggestionEntry[];
}

export interface LogEntry {
  timestamp: string;
  level: 'info' | 'warning' | 'error';
  message: string;
}
