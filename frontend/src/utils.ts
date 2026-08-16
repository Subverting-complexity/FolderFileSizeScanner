export function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const index = Math.min(i, units.length - 1);
  const value = bytes / Math.pow(1024, index);
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}m ${secs}s`;
}

export function truncatePath(path: string, maxLen: number = 80): string {
  if (path.length <= maxLen) return path;
  const start = path.substring(0, 20);
  const end = path.substring(path.length - (maxLen - 23));
  return `${start}...${end}`;
}

export function barColor(pct: number): string {
  if (pct >= 50) return '#dc2626';
  if (pct >= 35) return '#ea580c';
  if (pct >= 20) return '#d97706';
  if (pct >= 10) return '#65a30d';
  if (pct >= 5) return '#0d9488';
  if (pct >= 1) return '#0891b2';
  return '#2563eb';
}

export function buildBreadcrumbs(rootPath: string, currentPath: string): { label: string; path: string }[] {
  const rootNorm = rootPath.replace(/\\$/, '');
  const currentNorm = currentPath.replace(/\\$/, '');
  const parts: { label: string; path: string }[] = [{ label: rootPath, path: rootPath }];
  const relative = currentNorm.startsWith(rootNorm)
    ? currentNorm.substring(rootNorm.length).replace(/^\\/, '')
    : '';
  if (relative) {
    let buildPath = rootNorm;
    for (const seg of relative.split('\\')) {
      buildPath += '\\' + seg;
      parts.push({ label: seg, path: buildPath });
    }
  }
  return parts;
}
