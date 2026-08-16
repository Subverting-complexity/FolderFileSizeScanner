import { describe, it, expect } from 'vitest';
import { barColor, formatSize, formatElapsed, truncatePath, buildBreadcrumbs } from './utils';

describe('barColor', () => {
  it('returns red for >= 50%', () => {
    expect(barColor(50)).toBe('#dc2626');
    expect(barColor(75)).toBe('#dc2626');
    expect(barColor(100)).toBe('#dc2626');
  });

  it('returns orange for 35-49%', () => {
    expect(barColor(35)).toBe('#ea580c');
    expect(barColor(49)).toBe('#ea580c');
  });

  it('returns amber for 20-34%', () => {
    expect(barColor(20)).toBe('#d97706');
    expect(barColor(34)).toBe('#d97706');
  });

  it('returns green for 10-19%', () => {
    expect(barColor(10)).toBe('#65a30d');
    expect(barColor(19)).toBe('#65a30d');
  });

  it('returns teal for 5-9%', () => {
    expect(barColor(5)).toBe('#0d9488');
    expect(barColor(9)).toBe('#0d9488');
  });

  it('returns cyan for 1-4%', () => {
    expect(barColor(1)).toBe('#0891b2');
    expect(barColor(4)).toBe('#0891b2');
  });

  it('returns blue for < 1%', () => {
    expect(barColor(0)).toBe('#2563eb');
    expect(barColor(0.5)).toBe('#2563eb');
    expect(barColor(0.99)).toBe('#2563eb');
  });

  it('each tier returns a distinct color', () => {
    const colors = [barColor(0), barColor(2), barColor(7), barColor(15), barColor(25), barColor(40), barColor(60)];
    const unique = new Set(colors);
    expect(unique.size).toBe(7);
  });
});

describe('formatSize', () => {
  it('formats zero bytes', () => {
    expect(formatSize(0)).toBe('0 B');
  });

  it('formats bytes without decimal', () => {
    expect(formatSize(500)).toBe('500 B');
    expect(formatSize(1)).toBe('1 B');
  });

  it('formats kilobytes', () => {
    expect(formatSize(1024)).toBe('1.0 KB');
    expect(formatSize(1536)).toBe('1.5 KB');
  });

  it('formats megabytes', () => {
    expect(formatSize(1024 * 1024)).toBe('1.0 MB');
  });

  it('formats gigabytes', () => {
    expect(formatSize(1024 ** 3)).toBe('1.0 GB');
    expect(formatSize(525 * 1024 ** 3)).toBe('525.0 GB');
  });

  it('formats terabytes', () => {
    expect(formatSize(1024 ** 4)).toBe('1.0 TB');
  });

  it('caps at TB for very large values', () => {
    expect(formatSize(5000 * 1024 ** 4)).toContain('TB');
  });
});

describe('formatElapsed', () => {
  it('formats sub-minute as seconds', () => {
    expect(formatElapsed(0.5)).toBe('0.5s');
    expect(formatElapsed(30.5)).toBe('30.5s');
    expect(formatElapsed(59.9)).toBe('59.9s');
  });

  it('formats >= 60s as minutes and seconds', () => {
    expect(formatElapsed(60)).toBe('1m 0s');
    expect(formatElapsed(90)).toBe('1m 30s');
    expect(formatElapsed(3661)).toBe('61m 1s');
  });
});

describe('truncatePath', () => {
  it('returns short paths unchanged', () => {
    expect(truncatePath('C:\\short')).toBe('C:\\short');
    expect(truncatePath('C:\\Users\\a', 80)).toBe('C:\\Users\\a');
  });

  it('truncates long paths with ellipsis', () => {
    const long = 'C:\\' + 'a'.repeat(100);
    const result = truncatePath(long, 40);
    expect(result.length).toBeLessThanOrEqual(40);
    expect(result).toContain('...');
    expect(result.startsWith('C:\\')).toBe(true);
  });

  it('preserves start and end of path', () => {
    const long = 'C:\\StartDir\\' + 'middle\\'.repeat(20) + 'EndFile.txt';
    const result = truncatePath(long, 50);
    expect(result).toContain('...');
    expect(result).toContain('EndFile.txt');
  });
});

describe('buildBreadcrumbs', () => {
  it('returns single entry for drive root', () => {
    const result = buildBreadcrumbs('C:\\', 'C:\\');
    expect(result).toEqual([{ label: 'C:\\', path: 'C:\\' }]);
  });

  it('does not duplicate root path', () => {
    const result = buildBreadcrumbs('C:\\', 'C:\\');
    expect(result).toHaveLength(1);
  });

  it('builds path segments from root to subdirectory', () => {
    const result = buildBreadcrumbs('C:\\', 'C:\\Users\\adrie');
    expect(result).toEqual([
      { label: 'C:\\', path: 'C:\\' },
      { label: 'Users', path: 'C:\\Users' },
      { label: 'adrie', path: 'C:\\Users\\adrie' },
    ]);
  });

  it('handles directory names with spaces', () => {
    const result = buildBreadcrumbs('C:\\', 'C:\\Program Files\\App');
    expect(result).toEqual([
      { label: 'C:\\', path: 'C:\\' },
      { label: 'Program Files', path: 'C:\\Program Files' },
      { label: 'App', path: 'C:\\Program Files\\App' },
    ]);
  });

  it('handles non-root scan path', () => {
    const result = buildBreadcrumbs('C:\\Users', 'C:\\Users\\adrie\\Documents');
    expect(result).toEqual([
      { label: 'C:\\Users', path: 'C:\\Users' },
      { label: 'adrie', path: 'C:\\Users\\adrie' },
      { label: 'Documents', path: 'C:\\Users\\adrie\\Documents' },
    ]);
  });

  it('handles deeply nested paths', () => {
    const result = buildBreadcrumbs('C:\\', 'C:\\a\\b\\c\\d');
    expect(result).toHaveLength(5);
    expect(result[0]).toEqual({ label: 'C:\\', path: 'C:\\' });
    expect(result[4]).toEqual({ label: 'd', path: 'C:\\a\\b\\c\\d' });
  });

  it('each breadcrumb path is a valid prefix of the next', () => {
    const result = buildBreadcrumbs('C:\\', 'C:\\Users\\adrie\\Documents');
    for (let i = 1; i < result.length; i++) {
      expect(result[i].path.startsWith(result[i - 1].path.replace(/\\$/, ''))).toBe(true);
    }
  });

  it('handles root with trailing backslash matching current without', () => {
    const result = buildBreadcrumbs('C:\\', 'C:\\Windows');
    expect(result).toHaveLength(2);
    expect(result[0].label).toBe('C:\\');
    expect(result[1].label).toBe('Windows');
  });
});
