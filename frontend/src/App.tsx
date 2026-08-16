import { useState, useEffect, useCallback, useRef } from 'react';
import type { DriveInfo, ScanProgress, ScanResult, LogEntry } from './types';
import { fetchDrives, startScan } from './api';

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const index = Math.min(i, units.length - 1);
  const value = bytes / Math.pow(1024, index);
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}m ${secs}s`;
}

function truncatePath(path: string, maxLen: number = 80): string {
  if (path.length <= maxLen) return path;
  const start = path.substring(0, 20);
  const end = path.substring(path.length - (maxLen - 23));
  return `${start}...${end}`;
}

function driveTypeIcon(driveType: string): string {
  switch (driveType.toLowerCase()) {
    case 'fixed': return 'HDD';
    case 'removable': return 'USB';
    case 'network': return 'NET';
    case 'cdrom': return 'CD';
    default: return 'DRV';
  }
}

function categoryIcon(category: string): string {
  switch (category) {
    case 'Temporary Files': return 'TMP';
    case 'Browser Cache': return 'WEB';
    case 'Package Cache': return 'PKG';
    case 'System Cleanup': return 'SYS';
    case 'Thumbnail Cache': return 'IMG';
    case 'OneDrive': return 'CLD';
    case 'Recycle Bin': return 'DEL';
    case 'File Type': return 'EXT';
    default: return 'INFO';
  }
}

type LogFilter = 'all' | 'info' | 'warning' | 'error';

function LogFilteredView({ logs, full, autoScroll, emptyText }: {
  logs: LogEntry[];
  full?: boolean;
  autoScroll?: boolean;
  emptyText?: string;
}) {
  const logEndRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState<LogFilter>('all');

  useEffect(() => {
    if (autoScroll && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs.length, autoScroll]);

  const infoCount = logs.filter(l => l.level === 'info').length;
  const warningCount = logs.filter(l => l.level === 'warning').length;
  const errorCount = logs.filter(l => l.level === 'error').length;
  const filtered = filter === 'all' ? logs : logs.filter(l => l.level === filter);

  return (
    <>
      <div className="log-filters">
        <button className={`log-filter-btn ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>
          All <span className="filter-count">{logs.length}</span>
        </button>
        <button className={`log-filter-btn info ${filter === 'info' ? 'active' : ''}`} onClick={() => setFilter('info')}>
          Info <span className="filter-count">{infoCount}</span>
        </button>
        <button className={`log-filter-btn warning ${filter === 'warning' ? 'active' : ''}`} onClick={() => setFilter('warning')} disabled={warningCount === 0}>
          Warnings <span className="filter-count">{warningCount}</span>
        </button>
        <button className={`log-filter-btn error ${filter === 'error' ? 'active' : ''}`} onClick={() => setFilter('error')} disabled={errorCount === 0}>
          Errors <span className="filter-count">{errorCount}</span>
        </button>
      </div>
      <div className={`log-entries${full ? ' full' : ''}`}>
        {filtered.length === 0 ? (
          <div className="log-empty">{filter === 'all' ? (emptyText ?? 'No log entries yet...') : `No ${filter} entries`}</div>
        ) : (
          filtered.map((log, i) => (
            <div key={i} className={`log-entry log-${log.level}`}>
              <span className="log-time">{log.timestamp}</span>
              <span className={`log-level-badge ${log.level}`}>{log.level.toUpperCase()}</span>
              <span className="log-message">{log.message}</span>
            </div>
          ))
        )}
        <div ref={logEndRef} />
      </div>
    </>
  );
}

function LogPanel({ logs, expanded, onToggle }: { logs: LogEntry[]; expanded: boolean; onToggle: () => void }) {
  const warningCount = logs.filter(l => l.level === 'warning').length;
  const errorCount = logs.filter(l => l.level === 'error').length;

  return (
    <div className="log-panel">
      <button className="log-toggle" onClick={onToggle}>
        <span className="log-toggle-icon">{expanded ? '\u25BC' : '\u25B6'}</span>
        <span>Scan Log</span>
        <span className="log-counts">
          <span className="log-badge info">{logs.length}</span>
          {warningCount > 0 && <span className="log-badge warning">{warningCount}</span>}
          {errorCount > 0 && <span className="log-badge error">{errorCount}</span>}
        </span>
      </button>
      {expanded && <LogFilteredView logs={logs} autoScroll />}
    </div>
  );
}

export default function App() {
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [selectedDrive, setSelectedDrive] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [activeTab, setActiveTab] = useState<'largest' | 'suggestions' | 'logs'>('largest');
  const [error, setError] = useState<string | null>(null);
  const [customPath, setCustomPath] = useState('');
  const [loadingDrives, setLoadingDrives] = useState(true);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logsExpanded, setLogsExpanded] = useState(false);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    loadDrives();
  }, []);

  async function loadDrives() {
    setLoadingDrives(true);
    try {
      const driveList = await fetchDrives();
      setDrives(driveList.filter(d => d.isReady));
      setError(null);
    } catch {
      setError('Failed to load drives. Is the backend running on http://localhost:5000?');
    } finally {
      setLoadingDrives(false);
    }
  }

  const handleStartScan = useCallback((path: string) => {
    setSelectedDrive(path);
    setScanning(true);
    setProgress(null);
    setResult(null);
    setError(null);
    setActiveTab('largest');
    setLogs([]);
    setLogsExpanded(false);

    const cleanup = startScan(
      path,
      (p) => setProgress(p),
      (r) => {
        setResult(r);
        setScanning(false);
      },
      (log) => setLogs(prev => [...prev, log]),
      (err) => {
        setError(err);
        setScanning(false);
      }
    );
    cleanupRef.current = cleanup;
  }, []);

  const handleCancel = useCallback(() => {
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }
    setScanning(false);
    setSelectedDrive(null);
    setProgress(null);
  }, []);

  const handleReset = useCallback(() => {
    setSelectedDrive(null);
    setResult(null);
    setProgress(null);
    setError(null);
    setCustomPath('');
    setLogs([]);
    loadDrives();
  }, []);

  const handleCustomScan = useCallback(() => {
    const path = customPath.trim();
    if (path) {
      handleStartScan(path);
    }
  }, [customPath, handleStartScan]);

  // Screen 1: Drive Selection
  if (!scanning && !result) {
    return (
      <div className="app">
        <header className="header">
          <h1>Folder & File Size Scanner</h1>
          <p className="subtitle">Select a drive to scan or enter a custom path</p>
        </header>

        {error && <div className="error-banner">{error}</div>}

        <div className="custom-path">
          <input
            type="text"
            placeholder="Enter a custom folder path (e.g., C:\Users)"
            value={customPath}
            onChange={(e) => setCustomPath(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCustomScan()}
          />
          <button className="btn btn-primary" onClick={handleCustomScan} disabled={!customPath.trim()}>
            Scan Folder
          </button>
        </div>

        {loadingDrives ? (
          <div className="loading-drives">
            <div className="spinner" />
            <p>Loading drives...</p>
          </div>
        ) : (
          <div className="drive-grid">
            {drives.map((drive) => {
              const usedSpace = drive.totalSize - drive.freeSpace;
              const usagePercent = drive.totalSize > 0 ? (usedSpace / drive.totalSize) * 100 : 0;
              return (
                <button
                  key={drive.letter}
                  className="drive-card"
                  onClick={() => handleStartScan(`${drive.letter}:\\`)}
                >
                  <div className="drive-card-header">
                    <span className="drive-letter">{drive.letter}:</span>
                    <span className="drive-type-badge">{driveTypeIcon(drive.driveType)}</span>
                  </div>
                  <div className="drive-name">{drive.name || 'Local Disk'}</div>
                  <div className="usage-bar-container">
                    <div className="usage-bar">
                      <div
                        className={`usage-bar-fill ${usagePercent > 90 ? 'critical' : usagePercent > 70 ? 'warning' : ''}`}
                        style={{ width: `${usagePercent}%` }}
                      />
                    </div>
                    <div className="usage-text">
                      <span>{formatSize(usedSpace)} used</span>
                      <span>{formatSize(drive.freeSpace)} free</span>
                    </div>
                  </div>
                  <div className="drive-total">Total: {formatSize(drive.totalSize)}</div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // Screen 2: Scanning
  if (scanning) {
    return (
      <div className="app">
        <header className="header">
          <h1>Scanning {selectedDrive}</h1>
          <p className="subtitle">Analyzing folder and file sizes...</p>
        </header>

        <div className="scan-progress">
          {progress && progress.percentComplete != null ? (
            <div className="progress-ring-container">
              <svg className="progress-ring" viewBox="0 0 120 120">
                <circle className="progress-ring-bg" cx="60" cy="60" r="52" />
                <circle
                  className="progress-ring-fill"
                  cx="60" cy="60" r="52"
                  strokeDasharray={`${2 * Math.PI * 52}`}
                  strokeDashoffset={`${2 * Math.PI * 52 * (1 - progress.percentComplete / 100)}`}
                />
              </svg>
              <span className="progress-ring-text">{progress.percentComplete.toFixed(1)}%</span>
            </div>
          ) : (
            <div className="spinner large" />
          )}

          {progress ? (
            <>
              <div className="stats-grid four-col">
                <div className="stat-card">
                  <div className="stat-value">{progress.scannedFiles.toLocaleString()}</div>
                  <div className="stat-label">Files Scanned</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{progress.scannedDirs.toLocaleString()}</div>
                  <div className="stat-label">Directories</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{formatSize(progress.totalSize)}</div>
                  <div className="stat-label">Total Size</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{formatElapsed(progress.elapsedSeconds)}</div>
                  <div className="stat-label">Elapsed</div>
                </div>
              </div>

              <div className="current-dir">
                <span className="current-dir-label">Scanning:</span>
                <span className="current-dir-path">{truncatePath(progress.currentDir)}</span>
              </div>
            </>
          ) : (
            <p className="scan-initializing">Initializing scan...</p>
          )}

          <button className="btn btn-cancel" onClick={handleCancel}>
            Cancel Scan
          </button>
        </div>

        <LogPanel logs={logs} expanded={logsExpanded} onToggle={() => setLogsExpanded(!logsExpanded)} />
      </div>
    );
  }

  // Screen 3: Results
  if (result) {
    return (
      <div className="app">
        <header className="header">
          <h1>Scan Results</h1>
          <p className="subtitle">Scan of {selectedDrive} completed</p>
        </header>

        {error && <div className="error-banner">{error}</div>}

        <div className="stats-grid five-col summary-bar">
          <div className="stat-card">
            <div className="stat-value">{result.totalFiles.toLocaleString()}</div>
            <div className="stat-label">Total Files</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{result.totalDirs.toLocaleString()}</div>
            <div className="stat-label">Total Directories</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{formatSize(result.totalSize)}</div>
            <div className="stat-label">Total Size</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{formatElapsed(result.elapsedSeconds)}</div>
            <div className="stat-label">Scan Duration</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">
              {result.scanSpeedGBPerSec != null ? `${result.scanSpeedGBPerSec.toFixed(2)} GB/s` : '--'}
            </div>
            <div className="stat-label">Avg Scan Speed</div>
          </div>
        </div>

        <div className="tabs">
          <button
            className={`tab ${activeTab === 'largest' ? 'active' : ''}`}
            onClick={() => setActiveTab('largest')}
          >
            Largest Files
            <span className="tab-count">{result.largestFiles.length}</span>
          </button>
          <button
            className={`tab ${activeTab === 'suggestions' ? 'active' : ''}`}
            onClick={() => setActiveTab('suggestions')}
          >
            Cleanup Suggestions
            <span className="tab-count">{result.suggestions.length}</span>
          </button>
          <button
            className={`tab ${activeTab === 'logs' ? 'active' : ''}`}
            onClick={() => setActiveTab('logs')}
          >
            Scan Log
            <span className="tab-count">{logs.length}</span>
          </button>
        </div>

        {activeTab === 'largest' && (
          <div className="table-container">
            <table className="file-table">
              <thead>
                <tr>
                  <th className="col-rank">#</th>
                  <th className="col-path">File Path</th>
                  <th className="col-size">Size</th>
                  <th className="col-ext">Extension</th>
                  <th className="col-date">Last Modified</th>
                </tr>
              </thead>
              <tbody>
                {result.largestFiles.slice(0, 100).map((file, i) => (
                  <tr key={file.path}>
                    <td className="col-rank">{i + 1}</td>
                    <td className="col-path" title={file.path}>{file.path}</td>
                    <td className="col-size">{formatSize(file.size)}</td>
                    <td className="col-ext">{file.extension || '--'}</td>
                    <td className="col-date">{formatDate(file.lastModified)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'suggestions' && (
          <div className="suggestions-section">
            <p className="suggestions-disclaimer">
              These are suggestions only — this tool does not modify any files.
            </p>
            <div className="suggestion-cards">
              {result.suggestions
                .sort((a, b) => b.totalSize - a.totalSize)
                .map((suggestion, i) => (
                  <div key={i} className="suggestion-card">
                    <div className="suggestion-header">
                      <span className="suggestion-icon">{categoryIcon(suggestion.category)}</span>
                      <span className="suggestion-category">{suggestion.category}</span>
                    </div>
                    <p className="suggestion-description">{suggestion.description}</p>
                    <div className="suggestion-path" title={suggestion.path}>{suggestion.path}</div>
                    <div className="suggestion-stats">
                      <span className="suggestion-size">{formatSize(suggestion.totalSize)}</span>
                      <span className="suggestion-files">{suggestion.fileCount.toLocaleString()} files</span>
                    </div>
                  </div>
                ))}
              {result.suggestions.length === 0 && (
                <div className="no-suggestions">
                  <p>No cleanup suggestions found. Your drive looks tidy!</p>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'logs' && (
          <div className="log-results-panel">
            <LogFilteredView logs={logs} full emptyText="No log entries were recorded." />
          </div>
        )}

        <div className="results-actions">
          <button className="btn btn-primary" onClick={handleReset}>
            Scan Another Drive
          </button>
        </div>
      </div>
    );
  }

  return null;
}
