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
