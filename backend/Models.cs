namespace FolderFileSizeScanner;

public record DriveInfoModel(
    string Letter,
    string Name,
    string DriveType,
    long TotalSize,
    long FreeSpace,
    bool IsReady
);

public record FileEntry(
    string Path,
    long Size,
    string Extension,
    DateTime LastModified
);

public record ScanProgress(
    int ScannedFiles,
    int ScannedDirs,
    long TotalSize,
    string CurrentDir,
    double ElapsedSeconds,
    double? PercentComplete
);

public record SuggestionEntry(
    string Category,
    string Description,
    string Path,
    long TotalSize,
    int FileCount
);

public record ScanResult(
    int TotalFiles,
    int TotalDirs,
    long TotalSize,
    double ElapsedSeconds,
    double? ScanSpeedGBPerSec,
    List<FileEntry> LargestFiles,
    List<SuggestionEntry> Suggestions
);

public record LogEntry(
    string Timestamp,
    string Level,
    string Message
);

public record DirEntry(
    string Name,
    string Path,
    long Size,
    int FileCount,
    int SubDirCount
);

public record BrowseResult(
    string Path,
    long TotalSize,
    int TotalFiles,
    List<DirEntry> Directories,
    List<FileEntry> Files
);

public record CachedScan(
    string Id,
    string RootPath,
    DateTime ScannedAt,
    int TotalFiles,
    int TotalDirs,
    long TotalSize,
    double ElapsedSeconds
);

public record CachedScanDetail(
    string Id,
    string RootPath,
    DateTime ScannedAt,
    ScanResult Result,
    Dictionary<string, DirStatsDto> DirMap,
    Dictionary<string, List<FileEntry>> DirFiles
);

public record DirStatsDto(
    long OwnSize,
    int OwnFileCount,
    long TotalSize,
    int TotalFileCount,
    int SubDirCount
);
