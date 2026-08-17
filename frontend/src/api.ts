import type { DriveInfo, ScanProgress, ScanResult, LogEntry, BrowseResult, CachedScan } from './types';

const API_BASE = '/api';

export async function fetchDrives(): Promise<DriveInfo[]> {
  const res = await fetch(`${API_BASE}/drives`);
  if (!res.ok) throw new Error('Failed to fetch drives');
  return res.json();
}

export function startScan(
  path: string,
  onProgress: (progress: ScanProgress) => void,
  onComplete: (result: ScanResult) => void,
  onLog: (log: LogEntry) => void,
  onError: (error: string) => void
): () => void {
  const controller = new AbortController();

  (async () => {
    let res: Response;
    try {
      res = await fetch(`${API_BASE}/scan?path=${encodeURIComponent(path)}`, {
        signal: controller.signal,
      });
    } catch {
      if (!controller.signal.aborted)
        onError('Failed to connect to the scanner backend. Is it running?');
      return;
    }

    if (!res.ok) {
      const text = await res.text();
      onError(text || `Scan failed (status ${res.status})`);
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) {
      onError('Browser does not support streaming');
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    let currentEvent = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ') && currentEvent) {
            try {
              const parsed = JSON.parse(line.slice(6));
              if (currentEvent === 'progress') onProgress(parsed);
              else if (currentEvent === 'complete') onComplete(parsed);
              else if (currentEvent === 'log') onLog(parsed);
            } catch { /* skip malformed JSON */ }
            currentEvent = '';
          }
        }
      }
    } catch {
      if (!controller.signal.aborted)
        onError('Connection lost during scan');
    }
  })();

  return () => controller.abort();
}

export async function browse(path: string): Promise<BrowseResult> {
  const res = await fetch(`${API_BASE}/browse?path=${encodeURIComponent(path)}`);
  if (!res.ok) throw new Error('No scan data available for this path');
  return res.json();
}

export async function fetchCachedScans(): Promise<CachedScan[]> {
  const res = await fetch(`${API_BASE}/cache`);
  if (!res.ok) throw new Error('Failed to fetch cached scans');
  return res.json();
}

export async function loadCachedScan(id: string): Promise<ScanResult> {
  const loadRes = await fetch(`${API_BASE}/cache/${encodeURIComponent(id)}/load`, { method: 'POST' });
  if (!loadRes.ok) throw new Error('Failed to load cached scan');
  const detailRes = await fetch(`${API_BASE}/cache/${encodeURIComponent(id)}`);
  if (!detailRes.ok) throw new Error('Failed to fetch cached scan detail');
  const detail = await detailRes.json();
  return detail.result as ScanResult;
}

export async function deleteCachedScan(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/cache/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete cached scan');
}
