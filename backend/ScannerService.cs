using System.Diagnostics;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace FolderFileSizeScanner;

public class ScannerService
{
    private const int TopFileCount = 100;
    private const int MaxAccessDeniedLogs = 20;
    private const long LargeFileThreshold = 1L * 1024 * 1024 * 1024; // 1 GB
    private const int MaxCachedScans = 20;
    private static readonly Regex ValidCacheId = new(@"^[\w\-]+$", RegexOptions.Compiled);

    private static readonly int[] FileMilestones = [1000, 10_000, 50_000, 100_000, 250_000, 500_000, 1_000_000];
    private static readonly JsonSerializerOptions CacheJsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false
    };

    private int _scanning;
    private Dictionary<string, DirStats> _dirMap = new(StringComparer.OrdinalIgnoreCase);
    private Dictionary<string, List<FileEntry>> _dirFiles = new(StringComparer.OrdinalIgnoreCase);
    private Dictionary<string, List<string>> _childDirs = new(StringComparer.OrdinalIgnoreCase);
    private ScanResult? _lastResult;
    private string? _lastRootPath;

    public bool TryStartScan() => Interlocked.CompareExchange(ref _scanning, 1, 0) == 0;
    public void FinishScan() => Interlocked.Exchange(ref _scanning, 0);
    public bool IsScanning => Volatile.Read(ref _scanning) == 1;

    private static string CacheDir
    {
        get
        {
            var dir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "FolderFileSizeScanner", "cache");
            Directory.CreateDirectory(dir);
            return dir;
        }
    }

    private void BuildChildIndex()
    {
        var index = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);
        foreach (var dirPath in _dirMap.Keys)
        {
            var parent = Path.GetDirectoryName(dirPath);
            if (parent == null) continue;
            var normalizedParent = parent.TrimEnd('\\', '/');
            if (!index.TryGetValue(normalizedParent, out var list))
            {
                list = [];
                index[normalizedParent] = list;
            }
            list.Add(dirPath);
        }
        _childDirs = index;
    }

    public BrowseResult? Browse(string path)
    {
        var normalized = path.TrimEnd('\\', '/');
        if (!_dirMap.TryGetValue(normalized, out var stats))
            return null;

        var childDirs = new List<DirEntry>();
        var childFiles = new List<FileEntry>();

        if (_dirFiles.TryGetValue(normalized, out var files))
            childFiles = files;

        if (_childDirs.TryGetValue(normalized, out var children))
        {
            foreach (var dirPath in children)
            {
                if (_dirMap.TryGetValue(dirPath, out var dirStats))
                {
                    childDirs.Add(new DirEntry(
                        Path.GetFileName(dirPath),
                        dirPath,
                        dirStats.TotalSize,
                        dirStats.TotalFileCount,
                        dirStats.SubDirCount
                    ));
                }
            }
        }

        childDirs.Sort((a, b) => b.Size.CompareTo(a.Size));
        childFiles.Sort((a, b) => b.Size.CompareTo(a.Size));

        return new BrowseResult(path, stats.TotalSize, stats.TotalFileCount, childDirs, childFiles);
    }

    public async Task ScanAsync(
        string rootPath,
        Func<ScanProgress, Task> onProgress,
        Func<ScanResult, Task> onComplete,
        Func<LogEntry, Task> onLog,
        CancellationToken ct)
    {
        var topFiles = new PriorityQueue<FileEntry, long>();
        long totalSize = 0;
        int fileCount = 0;
        int dirCount = 0;
        int accessDeniedCount = 0;
        int milestoneIndex = 0;
        var sw = Stopwatch.StartNew();
        long lastReportMs = 0;

        var dirMap = new Dictionary<string, DirStats>(StringComparer.OrdinalIgnoreCase);
        var dirFiles = new Dictionary<string, List<FileEntry>>(StringComparer.OrdinalIgnoreCase);

        var suggestionDirs = BuildSuggestionPatterns(rootPath);
        var extensionSuggestions = new Dictionary<string, (long size, int count)>(StringComparer.OrdinalIgnoreCase)
        {
            [".tmp"] = (0, 0),
            [".temp"] = (0, 0),
            [".log"] = (0, 0),
            [".bak"] = (0, 0),
            [".dmp"] = (0, 0),
            [".old"] = (0, 0),
        };

        long estimatedTotal = 0;
        try
        {
            var driveRoot = Path.GetPathRoot(rootPath);
            if (driveRoot != null)
            {
                var driveInfo = new DriveInfo(driveRoot);
                if (driveInfo.IsReady)
                {
                    if (string.Equals(rootPath.TrimEnd('\\', '/'), driveRoot.TrimEnd('\\', '/'), StringComparison.OrdinalIgnoreCase))
                        estimatedTotal = driveInfo.TotalSize - driveInfo.AvailableFreeSpace;
                }
            }
        }
        catch { }

        await Log(onLog, "info", $"Starting scan of {rootPath}");
        if (estimatedTotal > 0)
            await Log(onLog, "info", $"Estimated drive usage: {FormatSize(estimatedTotal)}");

        if (suggestionDirs.Count > 0)
        {
            await Log(onLog, "info", $"Tracking {suggestionDirs.Count} known cleanup directories");
            foreach (var sd in suggestionDirs)
                await Log(onLog, "info", $"  Watching: [{sd.Category}] {sd.Path}");
        }

        var stack = new Stack<string>();
        stack.Push(rootPath);

        while (stack.Count > 0 && !ct.IsCancellationRequested)
        {
            var dir = stack.Pop();
            dirCount++;

            var normalizedDir = dir.TrimEnd('\\', '/');
            if (!dirMap.ContainsKey(normalizedDir))
                dirMap[normalizedDir] = new DirStats();

            if (sw.ElapsedMilliseconds - lastReportMs > 250)
            {
                lastReportMs = sw.ElapsedMilliseconds;
                double? pct = estimatedTotal > 0 ? Math.Min(99.9, (double)totalSize / estimatedTotal * 100) : null;
                await onProgress(new ScanProgress(fileCount, dirCount, totalSize, TruncatePath(dir), sw.Elapsed.TotalSeconds, pct));
            }

            try
            {
                var dirInfo = new DirectoryInfo(dir);
                foreach (var fsi in dirInfo.EnumerateFileSystemInfos())
                {
                    if (ct.IsCancellationRequested) break;
                    try
                    {
                        if (fsi is DirectoryInfo subDir)
                        {
                            if ((subDir.Attributes & FileAttributes.ReparsePoint) == 0)
                            {
                                stack.Push(subDir.FullName);
                                dirMap[normalizedDir].SubDirCount++;
                            }
                        }
                        else if (fsi is FileInfo info)
                        {
                            var size = info.Length;
                            totalSize += size;
                            fileCount++;

                            var ext = info.Extension.ToLowerInvariant();
                            var entry = new FileEntry(info.FullName, size, ext, info.LastWriteTimeUtc);

                            dirMap[normalizedDir].OwnSize += size;
                            dirMap[normalizedDir].OwnFileCount++;

                            if (!dirFiles.TryGetValue(normalizedDir, out var fileList))
                            {
                                fileList = [];
                                dirFiles[normalizedDir] = fileList;
                            }
                            fileList.Add(entry);

                            if (topFiles.Count < TopFileCount)
                                topFiles.Enqueue(entry, size);
                            else
                                topFiles.EnqueueDequeue(entry, size);

                            if (size >= LargeFileThreshold)
                                await Log(onLog, "info", $"Large file ({FormatSize(size)}): {info.FullName}");

                            var fullName = info.FullName;
                            foreach (var sd in suggestionDirs)
                            {
                                if (fullName.StartsWith(sd.Path + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) ||
                                    fullName.StartsWith(sd.Path + Path.AltDirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                                {
                                    sd.TotalSize += size;
                                    sd.FileCount++;
                                }
                            }

                            if (extensionSuggestions.TryGetValue(ext, out var counts))
                            {
                                extensionSuggestions[ext] = (counts.size + size, counts.count + 1);
                            }

                            if (milestoneIndex < FileMilestones.Length && fileCount >= FileMilestones[milestoneIndex])
                            {
                                await Log(onLog, "info", $"Progress: {fileCount:N0} files scanned ({FormatSize(totalSize)})");
                                milestoneIndex++;
                            }
                        }
                    }
                    catch (UnauthorizedAccessException)
                    {
                        accessDeniedCount++;
                        if (accessDeniedCount <= MaxAccessDeniedLogs)
                            await Log(onLog, "warning", $"Access denied (skipped): {fsi.FullName}");
                        else if (accessDeniedCount == MaxAccessDeniedLogs + 1)
                            await Log(onLog, "warning", "Further access-denied entries will be summarized at the end");
                    }
                    catch { }
                }
            }
            catch (UnauthorizedAccessException)
            {
                accessDeniedCount++;
                if (accessDeniedCount <= MaxAccessDeniedLogs)
                    await Log(onLog, "warning", $"Access denied (skipped): {dir}");
            }
            catch { }
        }

        if (ct.IsCancellationRequested)
        {
            await Log(onLog, "warning", "Scan was cancelled by user");
            return;
        }

        PropagateSubtreeSizes(dirMap, rootPath.TrimEnd('\\', '/'));

        _dirMap = dirMap;
        _dirFiles = dirFiles;
        _lastRootPath = rootPath;
        BuildChildIndex();

        if (accessDeniedCount > MaxAccessDeniedLogs)
            await Log(onLog, "warning", $"Total access-denied entries: {accessDeniedCount} ({accessDeniedCount - MaxAccessDeniedLogs} suppressed from log)");

        var largestFiles = new List<FileEntry>();
        while (topFiles.Count > 0)
            largestFiles.Add(topFiles.Dequeue());
        largestFiles.Reverse();

        var suggestions = new List<SuggestionEntry>();
        foreach (var sd in suggestionDirs.Where(s => s.TotalSize > 0).OrderByDescending(s => s.TotalSize))
        {
            suggestions.Add(new SuggestionEntry(sd.Category, sd.Description, sd.Path, sd.TotalSize, sd.FileCount));
            await Log(onLog, "info", $"Suggestion: [{sd.Category}] {sd.Description} — {FormatSize(sd.TotalSize)} in {sd.FileCount:N0} files");
        }

        foreach (var (ext, (size, count)) in extensionSuggestions.Where(e => e.Value.count > 0).OrderByDescending(e => e.Value.size))
        {
            suggestions.Add(new SuggestionEntry("File Type", $"{ext} files (scattered)", $"*{ext}", size, count));
            if (size > 10 * 1024 * 1024)
                await Log(onLog, "info", $"Suggestion: {count:N0} {ext} files totaling {FormatSize(size)}");
        }

        var elapsed = sw.Elapsed.TotalSeconds;
        double? speedGBPerSec = elapsed > 0.001 ? (totalSize / (1024.0 * 1024 * 1024)) / elapsed : null;

        await Log(onLog, "info", $"Scan complete: {fileCount:N0} files, {dirCount:N0} directories, {FormatSize(totalSize)} total in {elapsed:F1}s");
        if (speedGBPerSec.HasValue)
            await Log(onLog, "info", $"Average scan speed: {speedGBPerSec.Value:F2} GB/s");

        var scanResult = new ScanResult(fileCount, dirCount, totalSize, elapsed, speedGBPerSec, largestFiles, suggestions);
        _lastResult = scanResult;
        SaveToCache(rootPath, scanResult, dirMap, dirFiles);
        await onComplete(scanResult);
    }

    public void SaveToCache(string rootPath, ScanResult result,
        Dictionary<string, DirStats> dirMap, Dictionary<string, List<FileEntry>> dirFiles)
    {
        try
        {
            var id = DateTime.UtcNow.ToString("yyyyMMdd-HHmmss-fff") + "-" + Guid.NewGuid().ToString("N")[..4];
            var scannedAt = DateTime.UtcNow;
            var detail = new CachedScanDetail(
                id, rootPath, scannedAt, result,
                dirMap.ToDictionary(
                    kv => kv.Key,
                    kv => new DirStatsDto(kv.Value.OwnSize, kv.Value.OwnFileCount,
                        kv.Value.TotalSize, kv.Value.TotalFileCount, kv.Value.SubDirCount)),
                dirFiles);
            var json = JsonSerializer.Serialize(detail, CacheJsonOptions);
            var filePath = Path.Combine(CacheDir, $"scan-{id}.json");
            File.WriteAllText(filePath, json);

            var meta = new CachedScan(id, rootPath, scannedAt,
                result.TotalFiles, result.TotalDirs, result.TotalSize, result.ElapsedSeconds);
            var metaJson = JsonSerializer.Serialize(meta, CacheJsonOptions);
            File.WriteAllText(Path.Combine(CacheDir, $"meta-{id}.json"), metaJson);

            PruneCacheFiles();
        }
        catch { }
    }

    public List<CachedScan> ListCachedScans()
    {
        var results = new List<CachedScan>();
        try
        {
            foreach (var file in Directory.EnumerateFiles(CacheDir, "scan-*.json")
                         .OrderByDescending(f => f))
            {
                try
                {
                    var scanFileName = Path.GetFileName(file);
                    var metaFile = Path.Combine(CacheDir, "meta-" + scanFileName[5..]);
                    if (File.Exists(metaFile))
                    {
                        var metaJson = File.ReadAllText(metaFile);
                        var meta = JsonSerializer.Deserialize<CachedScan>(metaJson, CacheJsonOptions);
                        if (meta != null) { results.Add(meta); continue; }
                    }

                    using var stream = File.OpenRead(file);
                    var detail = JsonSerializer.Deserialize<CachedScanDetail>(stream, CacheJsonOptions);
                    if (detail != null)
                    {
                        results.Add(new CachedScan(detail.Id, detail.RootPath, detail.ScannedAt,
                            detail.Result.TotalFiles, detail.Result.TotalDirs,
                            detail.Result.TotalSize, detail.Result.ElapsedSeconds));
                    }
                }
                catch { }
            }
        }
        catch { }
        return results;
    }

    public CachedScanDetail? LoadCachedScan(string id)
    {
        if (!ValidCacheId.IsMatch(id)) return null;
        try
        {
            var filePath = Path.Combine(CacheDir, $"scan-{id}.json");
            if (!File.Exists(filePath)) return null;
            var json = File.ReadAllText(filePath);
            return JsonSerializer.Deserialize<CachedScanDetail>(json, CacheJsonOptions);
        }
        catch { return null; }
    }

    public bool LoadCacheForBrowsing(string id)
    {
        if (!ValidCacheId.IsMatch(id)) return false;
        var cached = LoadCachedScan(id);
        if (cached == null) return false;

        var dirMap = new Dictionary<string, DirStats>(StringComparer.OrdinalIgnoreCase);
        foreach (var (path, dto) in cached.DirMap)
        {
            dirMap[path] = new DirStats
            {
                OwnSize = dto.OwnSize,
                OwnFileCount = dto.OwnFileCount,
                TotalSize = dto.TotalSize,
                TotalFileCount = dto.TotalFileCount,
                SubDirCount = dto.SubDirCount
            };
        }

        var dirFiles = new Dictionary<string, List<FileEntry>>(StringComparer.OrdinalIgnoreCase);
        foreach (var (path, files) in cached.DirFiles)
            dirFiles[path] = files;

        _dirMap = dirMap;
        _dirFiles = dirFiles;
        _lastResult = cached.Result;
        _lastRootPath = cached.RootPath;
        BuildChildIndex();
        return true;
    }

    public bool DeleteCachedScan(string id)
    {
        if (!ValidCacheId.IsMatch(id)) return false;
        try
        {
            var filePath = Path.Combine(CacheDir, $"scan-{id}.json");
            if (File.Exists(filePath))
            {
                File.Delete(filePath);
                try { File.Delete(Path.Combine(CacheDir, $"meta-{id}.json")); } catch { }
                return true;
            }
        }
        catch { }
        return false;
    }

    private static void PruneCacheFiles()
    {
        try
        {
            var files = Directory.GetFiles(CacheDir, "scan-*.json")
                .OrderByDescending(f => f)
                .Skip(MaxCachedScans)
                .ToList();
            foreach (var file in files)
            {
                try { File.Delete(file); } catch { }
                var metaFile = Path.Combine(CacheDir, "meta-" + Path.GetFileName(file)[5..]);
                try { File.Delete(metaFile); } catch { }
            }
        }
        catch { }
    }

    private static void PropagateSubtreeSizes(Dictionary<string, DirStats> dirMap, string root)
    {
        var children = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);
        foreach (var dirPath in dirMap.Keys)
        {
            var parent = Path.GetDirectoryName(dirPath);
            if (parent != null)
            {
                var normalizedParent = parent.TrimEnd('\\', '/');
                if (!children.TryGetValue(normalizedParent, out var list))
                {
                    list = [];
                    children[normalizedParent] = list;
                }
                list.Add(dirPath);
            }
        }

        long Aggregate(string path)
        {
            var stats = dirMap[path];
            long subtreeSize = stats.OwnSize;
            int subtreeFiles = stats.OwnFileCount;

            if (children.TryGetValue(path, out var kids))
            {
                foreach (var child in kids)
                {
                    subtreeSize += Aggregate(child);
                    subtreeFiles += dirMap[child].TotalFileCount;
                }
            }

            stats.TotalSize = subtreeSize;
            stats.TotalFileCount = subtreeFiles;
            return subtreeSize;
        }

        if (dirMap.ContainsKey(root))
            Aggregate(root);
    }

    private static async Task Log(Func<LogEntry, Task> onLog, string level, string message)
    {
        var entry = new LogEntry(DateTime.Now.ToString("HH:mm:ss.fff"), level, message);
        await onLog(entry);
    }

    internal static string FormatSize(long bytes)
    {
        if (bytes < 1024) return $"{bytes} B";
        string[] units = ["KB", "MB", "GB", "TB"];
        double size = bytes;
        int i = -1;
        do { size /= 1024; i++; } while (size >= 1024 && i < units.Length - 1);
        return $"{size:F1} {units[i]}";
    }

    private static string TruncatePath(string path)
    {
        if (path.Length <= 60) return path;
        var parts = path.Split(Path.DirectorySeparatorChar);
        if (parts.Length <= 3) return path;
        return parts[0] + @"\" + parts[1] + @"\...\" + parts[^1];
    }

    private static List<SuggestionDir> BuildSuggestionPatterns(string rootPath)
    {
        var userProfile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var roamingAppData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        var driveRoot = Path.GetPathRoot(rootPath) ?? rootPath;

        var patterns = new List<(string Category, string Description, string Path)>
        {
            ("Temporary Files", "Windows user temp files", Path.Combine(localAppData, "Temp")),
            ("Temporary Files", "System temp files", Path.Combine(driveRoot, "Windows", "Temp")),

            ("Browser Cache", "Chrome cache & data", Path.Combine(localAppData, "Google", "Chrome", "User Data")),
            ("Browser Cache", "Edge cache & data", Path.Combine(localAppData, "Microsoft", "Edge", "User Data")),
            ("Browser Cache", "Firefox profiles", Path.Combine(localAppData, "Mozilla", "Firefox", "Profiles")),

            ("Package Cache", "npm cache", Path.Combine(localAppData, "npm-cache")),
            ("Package Cache", "npm cache (roaming)", Path.Combine(roamingAppData, "npm", "cache")),
            ("Package Cache", "NuGet global packages", Path.Combine(userProfile, ".nuget", "packages")),
            ("Package Cache", "pip cache", Path.Combine(localAppData, "pip", "cache")),
            ("Package Cache", "yarn cache", Path.Combine(localAppData, "Yarn", "Cache")),
            ("Package Cache", "pnpm store", Path.Combine(localAppData, "pnpm-store")),

            ("System Cleanup", "Windows Update downloads", Path.Combine(driveRoot, "Windows", "SoftwareDistribution", "Download")),
            ("System Cleanup", "Previous Windows installation", Path.Combine(driveRoot, "Windows.old")),
            ("System Cleanup", "Crash dumps", Path.Combine(localAppData, "CrashDumps")),
            ("System Cleanup", "Windows Error Reports", Path.Combine(localAppData, "Microsoft", "Windows", "WER")),

            ("Thumbnail Cache", "Explorer thumbnail cache", Path.Combine(localAppData, "Microsoft", "Windows", "Explorer")),

            ("OneDrive", "OneDrive synced files (may have cloud backup)", Path.Combine(userProfile, "OneDrive")),

            ("Recycle Bin", "Deleted files in Recycle Bin", Path.Combine(driveRoot, "$Recycle.Bin")),
        };

        var result = new List<SuggestionDir>();
        foreach (var (category, description, path) in patterns)
        {
            if (path.StartsWith(driveRoot, StringComparison.OrdinalIgnoreCase) &&
                Directory.Exists(path))
            {
                result.Add(new SuggestionDir(category, description, path));
            }
        }

        return result;
    }
}

public class DirStats
{
    public long OwnSize { get; set; }
    public int OwnFileCount { get; set; }
    public long TotalSize { get; set; }
    public int TotalFileCount { get; set; }
    public int SubDirCount { get; set; }
}

public class SuggestionDir
{
    public string Category { get; }
    public string Description { get; }
    public string Path { get; }
    public long TotalSize { get; set; }
    public int FileCount { get; set; }

    public SuggestionDir(string category, string description, string path)
    {
        Category = category;
        Description = description;
        Path = path;
    }
}
