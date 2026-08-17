import { useState, useEffect, useCallback, useRef } from 'react';
import type { DriveInfo, ScanProgress, ScanResult, LogEntry, BrowseResult, CachedScan } from './types';
import { fetchDrives, startScan, browse, fetchCachedScans, loadCachedScan, deleteCachedScan } from './api';
import { formatSize, formatDate, formatElapsed, truncatePath, barColor, buildBreadcrumbs } from './utils';

type Theme = 'light' | 'dark' | 'system';

function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = localStorage.getItem('theme');
    if (stored === 'light' || stored === 'dark') return stored;
    return 'system';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') {
      root.removeAttribute('data-theme');
      localStorage.removeItem('theme');
    } else {
      root.setAttribute('data-theme', theme);
      localStorage.setItem('theme', theme);
    }
  }, [theme]);

  return [theme, setThemeState];
}

function ThemeToggle({ theme, setTheme }: { theme: Theme; setTheme: (t: Theme) => void }) {
  const cycle = () => {
    if (theme === 'system') setTheme('light');
    else if (theme === 'light') setTheme('dark');
    else setTheme('system');
  };

  const icon = theme === 'light' ? '☀️' : theme === 'dark' ? '🌙' : '💻';
  const label = theme === 'light' ? 'Light' : theme === 'dark' ? 'Dark' : 'System';

  return (
    <button className="theme-toggle" onClick={cycle} title={`Theme: ${label}`}>
      {icon}
    </button>
  );
}

function SortIndicator({ active, dir }: { active: boolean; dir: 'asc' | 'desc' }) {
  if (!active) return <span className="sort-arrow muted">↕</span>;
  return <span className="sort-arrow active">{dir === 'asc' ? '↑' : '↓'}</span>;
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

function DirectoryBrowser({ rootPath }: { rootPath: string }) {
  const [browseData, setBrowseData] = useState<BrowseResult | null>(null);
  const [currentPath, setCurrentPath] = useState(rootPath);
  const [loading, setLoading] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [dirSort, setDirSort] = useState<{ key: 'name' | 'size' | 'fileCount'; dir: 'asc' | 'desc' }>({ key: 'size', dir: 'desc' });
  const [fileSort, setFileSort] = useState<{ key: 'name' | 'size' | 'lastModified'; dir: 'asc' | 'desc' }>({ key: 'size', dir: 'desc' });

  const loadDir = useCallback(async (path: string) => {
    setLoading(true);
    setBrowseError(null);
    try {
      const data = await browse(path);
      setBrowseData(data);
      setCurrentPath(path);
    } catch {
      setBrowseError('Failed to load directory data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDir(rootPath);
  }, [rootPath, loadDir]);

  const breadcrumbs = buildBreadcrumbs(rootPath, currentPath);

  if (loading && !browseData) {
    return (
      <div className="loading-drives">
        <div className="spinner" />
        <p>Loading directory data...</p>
      </div>
    );
  }

  if (browseError) {
    return <div className="error-banner">{browseError}</div>;
  }

  if (!browseData) return null;

  const parentSize = browseData.totalSize || 1;

  const toggleDirSort = (key: typeof dirSort.key) => {
    setDirSort(prev => prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' ? 'asc' : 'desc' });
  };
  const toggleFileSort = (key: typeof fileSort.key) => {
    setFileSort(prev => prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' ? 'asc' : 'desc' });
  };

  const sortedDirs = [...browseData.directories].sort((a, b) => {
    const mul = dirSort.dir === 'asc' ? 1 : -1;
    if (dirSort.key === 'name') return mul * a.name.localeCompare(b.name);
    if (dirSort.key === 'fileCount') return mul * (a.fileCount - b.fileCount);
    return mul * (a.size - b.size);
  });

  const sortedFiles = [...browseData.files].sort((a, b) => {
    const mul = fileSort.dir === 'asc' ? 1 : -1;
    if (fileSort.key === 'name') return mul * (a.path.split('\\').pop() || '').localeCompare(b.path.split('\\').pop() || '');
    if (fileSort.key === 'lastModified') return mul * (new Date(a.lastModified).getTime() - new Date(b.lastModified).getTime());
    return mul * (a.size - b.size);
  });

  return (
    <div className="browser-section">
      <div className="breadcrumb-bar">
        {breadcrumbs.map((crumb, i) => (
          <span key={crumb.path}>
            {i > 0 && <span className="breadcrumb-sep">&rsaquo;</span>}
            <button
              className={`breadcrumb-btn ${crumb.path === currentPath ? 'active' : ''}`}
              onClick={() => loadDir(crumb.path)}
              disabled={crumb.path === currentPath}
            >
              {crumb.label}
            </button>
          </span>
        ))}
      </div>

      <div className="browser-summary">
        <span>{formatSize(browseData.totalSize)} total</span>
        <span className="browser-summary-sep">|</span>
        <span>{browseData.directories.length} folders</span>
        <span className="browser-summary-sep">|</span>
        <span>{browseData.files.length} files</span>
      </div>

      {browseData.directories.length > 0 && (() => {
        const maxDirSize = Math.max(...browseData.directories.map(d => d.size), 1);
        return (
        <div className="browser-list">
          <div className="browser-row browser-header">
            <span className="browser-icon-spacer" />
            <button className="sort-btn" onClick={() => toggleDirSort('name')}>
              Name <SortIndicator active={dirSort.key === 'name'} dir={dirSort.dir} />
            </button>
            <button className="sort-btn" onClick={() => toggleDirSort('size')}>
              Usage <SortIndicator active={dirSort.key === 'size'} dir={dirSort.dir} />
            </button>
            <button className="sort-btn right" onClick={() => toggleDirSort('size')}>
              Size <SortIndicator active={dirSort.key === 'size'} dir={dirSort.dir} />
            </button>
            <button className="sort-btn right" onClick={() => toggleDirSort('fileCount')}>
              Files <SortIndicator active={dirSort.key === 'fileCount'} dir={dirSort.dir} />
            </button>
          </div>
          {sortedDirs.map(dir => {
            const pct = parentSize > 0 ? (dir.size / parentSize) * 100 : 0;
            const colorPct = (dir.size / maxDirSize) * 100;
            return (
              <button key={dir.path} className="browser-row dir-row" onClick={() => loadDir(dir.path)}>
                <span className="browser-icon">DIR</span>
                <span className="browser-name" title={dir.path}>{dir.name}</span>
                <span className="browser-bar-wrapper">
                  <span className="browser-bar">
                    <span
                      className="browser-bar-fill"
                      style={{ width: `${Math.max(pct, 0.5)}%`, background: barColor(colorPct) }}
                    />
                  </span>
                  <span className="browser-pct">{pct.toFixed(1)}%</span>
                </span>
                <span className="browser-size">{formatSize(dir.size)}</span>
                <span className="browser-meta">{dir.fileCount.toLocaleString()} files</span>
              </button>
            );
          })}
        </div>
        );
      })()}

      {browseData.files.length > 0 && (() => {
        const maxFileSize = Math.max(...browseData.files.map(f => f.size), 1);
        return (
        <div className="browser-list">
          <div className="browser-row browser-header">
            <span className="browser-icon-spacer" />
            <button className="sort-btn" onClick={() => toggleFileSort('name')}>
              Name <SortIndicator active={fileSort.key === 'name'} dir={fileSort.dir} />
            </button>
            <button className="sort-btn" onClick={() => toggleFileSort('size')}>
              Usage <SortIndicator active={fileSort.key === 'size'} dir={fileSort.dir} />
            </button>
            <button className="sort-btn right" onClick={() => toggleFileSort('size')}>
              Size <SortIndicator active={fileSort.key === 'size'} dir={fileSort.dir} />
            </button>
            <button className="sort-btn right" onClick={() => toggleFileSort('lastModified')}>
              Modified <SortIndicator active={fileSort.key === 'lastModified'} dir={fileSort.dir} />
            </button>
          </div>
          {sortedFiles.map(file => {
            const pct = parentSize > 0 ? (file.size / parentSize) * 100 : 0;
            const colorPct = (file.size / maxFileSize) * 100;
            return (
              <div key={file.path} className="browser-row file-row">
                <span className="browser-icon file-icon">{file.extension?.replace('.', '').toUpperCase().slice(0, 4) || 'FILE'}</span>
                <span className="browser-name" title={file.path}>{file.path.split('\\').pop()}</span>
                <span className="browser-bar-wrapper">
                  <span className="browser-bar">
                    <span
                      className="browser-bar-fill"
                      style={{ width: `${Math.max(pct, 0.3)}%`, background: barColor(colorPct) }}
                    />
                  </span>
                  <span className="browser-pct">{pct < 0.1 ? '<0.1' : pct.toFixed(1)}%</span>
                </span>
                <span className="browser-size">{formatSize(file.size)}</span>
                <span className="browser-meta">{formatDate(file.lastModified)}</span>
              </div>
            );
          })}
        </div>
        );
      })()}

      {browseData.directories.length === 0 && browseData.files.length === 0 && (
        <div className="no-suggestions"><p>This directory is empty.</p></div>
      )}
    </div>
  );
}

function ScanHistory({ onLoadScan, onClose }: {
  onLoadScan: (id: string, rootPath: string, result?: ScanResult) => void;
  onClose: () => void;
}) {
  const [scans, setScans] = useState<CachedScan[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setScans(await fetchCachedScans());
      } catch { /* ignore */ }
      setLoading(false);
    })();
  }, []);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      return;
    }
    setConfirmDeleteId(null);
    try {
      await deleteCachedScan(id);
      setScans(prev => prev.filter(s => s.id !== id));
    } catch { /* ignore */ }
  };

  const handleLoad = async (scan: CachedScan) => {
    setLoadingId(scan.id);
    try {
      const cachedResult = await loadCachedScan(scan.id);
      onLoadScan(scan.id, scan.rootPath, cachedResult);
    } catch { /* ignore */ }
    setLoadingId(null);
  };

  if (loading) {
    return (
      <div className="history-panel">
        <div className="history-header">
          <h3>Scan History</h3>
          <button className="btn btn-cancel btn-sm" onClick={onClose}>Close</button>
        </div>
        <div className="loading-drives"><div className="spinner" /><p>Loading...</p></div>
      </div>
    );
  }

  return (
    <div className="history-panel">
      <div className="history-header">
        <h3>Scan History</h3>
        <button className="btn btn-cancel btn-sm" onClick={onClose}>Close</button>
      </div>
      {scans.length === 0 ? (
        <div className="no-suggestions"><p>No cached scans found. Run a scan first.</p></div>
      ) : (
        <div className="history-list">
          {scans.map(scan => (
            <div key={scan.id} className="history-item">
              <div className="history-item-main">
                <div className="history-item-path">{scan.rootPath}</div>
                <div className="history-item-meta">
                  <span>{formatDate(scan.scannedAt)}</span>
                  <span className="browser-summary-sep">|</span>
                  <span>{scan.totalFiles.toLocaleString()} files</span>
                  <span className="browser-summary-sep">|</span>
                  <span>{formatSize(scan.totalSize)}</span>
                  <span className="browser-summary-sep">|</span>
                  <span>{formatElapsed(scan.elapsedSeconds)}</span>
                </div>
              </div>
              <div className="history-item-actions">
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => handleLoad(scan)}
                  disabled={loadingId !== null}
                >
                  {loadingId === scan.id ? 'Loading...' : 'Browse'}
                </button>
                <button
                  className={`btn btn-sm ${confirmDeleteId === scan.id ? 'btn-cancel' : 'btn-secondary'}`}
                  onClick={() => handleDelete(scan.id)}
                  onBlur={() => setConfirmDeleteId(null)}
                  disabled={loadingId !== null}
                >
                  {confirmDeleteId === scan.id ? 'Confirm?' : 'Delete'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [theme, setTheme] = useTheme();
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [selectedDrive, setSelectedDrive] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [activeTab, setActiveTab] = useState<'largest' | 'browse' | 'suggestions' | 'logs'>('largest');
  const [error, setError] = useState<string | null>(null);
  const [customPath, setCustomPath] = useState('');
  const [loadingDrives, setLoadingDrives] = useState(true);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logsExpanded, setLogsExpanded] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const cleanupRef = useRef<(() => void) | null>(null);
  const [fileTableSort, setFileTableSort] = useState<{ key: 'path' | 'size' | 'extension' | 'lastModified'; dir: 'asc' | 'desc' }>({ key: 'size', dir: 'desc' });
  const [fileSearch, setFileSearch] = useState('');

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
    setShowHistory(false);
    setFileTableSort({ key: 'size', dir: 'desc' });
    setFileSearch('');

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
    setShowHistory(false);
    loadDrives();
  }, []);

  const handleCustomScan = useCallback(() => {
    const path = customPath.trim();
    if (path) {
      handleStartScan(path);
    }
  }, [customPath, handleStartScan]);

  const handleLoadCachedScan = useCallback((id: string, rootPath: string, cachedResult?: ScanResult) => {
    setSelectedDrive(rootPath);
    setResult(cachedResult ?? { totalFiles: 0, totalDirs: 0, totalSize: 0, elapsedSeconds: 0, scanSpeedGBPerSec: null, largestFiles: [], suggestions: [] });
    setActiveTab(cachedResult && cachedResult.largestFiles.length > 0 ? 'largest' : 'browse');
    setShowHistory(false);
    setLogs([]);
  }, []);

  // Screen 1: Drive Selection
  if (!scanning && !result) {
    return (
      <div className="app">
        <header className="header">
          <ThemeToggle theme={theme} setTheme={setTheme} />
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
          <button className="btn btn-secondary" onClick={() => setShowHistory(!showHistory)}>
            History
          </button>
        </div>

        {showHistory && (
          <ScanHistory
            onLoadScan={handleLoadCachedScan}
            onClose={() => setShowHistory(false)}
          />
        )}

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
          <ThemeToggle theme={theme} setTheme={setTheme} />
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
    const showSummary = result.totalFiles > 0;
    const toggleFileTableSort = (key: typeof fileTableSort.key) => {
      setFileTableSort(prev => prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'path' || key === 'extension' ? 'asc' : 'desc' });
    };
    const sortedLargest = [...result.largestFiles].sort((a, b) => {
      const mul = fileTableSort.dir === 'asc' ? 1 : -1;
      if (fileTableSort.key === 'path') return mul * a.path.localeCompare(b.path);
      if (fileTableSort.key === 'extension') return mul * (a.extension || '').localeCompare(b.extension || '');
      if (fileTableSort.key === 'lastModified') return mul * (new Date(a.lastModified).getTime() - new Date(b.lastModified).getTime());
      return mul * (a.size - b.size);
    });
    const filteredLargest = fileSearch
      ? sortedLargest.filter(f => f.path.toLowerCase().includes(fileSearch.toLowerCase()) || (f.extension || '').toLowerCase().includes(fileSearch.toLowerCase()))
      : sortedLargest;
    const originalRanks = new Map(
      [...result.largestFiles].sort((a, b) => b.size - a.size).map((f, i) => [f.path, i + 1])
    );
    const maxFileSize = result.largestFiles.length > 0
      ? Math.max(...result.largestFiles.map(f => f.size))
      : 1;
    return (
      <div className="app">
        <header className="header">
          <ThemeToggle theme={theme} setTheme={setTheme} />
          <h1>Scan Results</h1>
          <p className="subtitle">Scan of {selectedDrive} completed</p>
        </header>

        {error && <div className="error-banner">{error}</div>}

        {showSummary && (
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
        )}

        <div className="tabs">
          {showSummary && (
            <button
              className={`tab ${activeTab === 'largest' ? 'active' : ''}`}
              onClick={() => setActiveTab('largest')}
            >
              Largest Files
              <span className="tab-count">{result.largestFiles.length}</span>
            </button>
          )}
          <button
            className={`tab ${activeTab === 'browse' ? 'active' : ''}`}
            onClick={() => setActiveTab('browse')}
          >
            Browse Directories
          </button>
          {showSummary && (
            <>
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
            </>
          )}
        </div>

        {activeTab === 'largest' && showSummary && (
          <>
            <div className="table-toolbar">
              <div className="table-search">
                <input
                  type="text"
                  placeholder="Filter by path or extension..."
                  value={fileSearch}
                  onChange={e => setFileSearch(e.target.value)}
                />
                {fileSearch && <button className="table-search-clear" onClick={() => setFileSearch('')}>&times;</button>}
              </div>
              <span className="table-count">{filteredLargest.length} of {result.largestFiles.length} files</span>
            </div>
            <div className="table-container">
              <table className="file-table">
                <thead>
                  <tr>
                    <th className="col-rank">#</th>
                    <th className="col-path sortable-th" onClick={() => toggleFileTableSort('path')}>
                      File Path <SortIndicator active={fileTableSort.key === 'path'} dir={fileTableSort.dir} />
                    </th>
                    <th className="col-bar-header"></th>
                    <th className="col-size sortable-th" onClick={() => toggleFileTableSort('size')}>
                      Size <SortIndicator active={fileTableSort.key === 'size'} dir={fileTableSort.dir} />
                    </th>
                    <th className="col-ext sortable-th" onClick={() => toggleFileTableSort('extension')}>
                      Ext <SortIndicator active={fileTableSort.key === 'extension'} dir={fileTableSort.dir} />
                    </th>
                    <th className="col-date sortable-th" onClick={() => toggleFileTableSort('lastModified')}>
                      Modified <SortIndicator active={fileTableSort.key === 'lastModified'} dir={fileTableSort.dir} />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLargest.slice(0, 100).map((file) => {
                    const filePct = (file.size / maxFileSize) * 100;
                    return (
                      <tr key={file.path}>
                        <td className="col-rank">{originalRanks.get(file.path) ?? '--'}</td>
                        <td className="col-path" title={file.path}>{file.path}</td>
                        <td className="col-bar-cell">
                          <div className="file-size-bar">
                            <div className="file-size-bar-fill" style={{ width: `${filePct}%`, background: barColor(filePct) }} />
                          </div>
                        </td>
                        <td className="col-size">{formatSize(file.size)}</td>
                        <td className="col-ext">{file.extension || '--'}</td>
                        <td className="col-date">{formatDate(file.lastModified)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {activeTab === 'browse' && selectedDrive && (
          <DirectoryBrowser rootPath={selectedDrive} />
        )}

        {activeTab === 'suggestions' && showSummary && (
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

        {activeTab === 'logs' && showSummary && (
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
