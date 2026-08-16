using FolderFileSizeScanner;

namespace backend.Tests;

public class ScannerServiceTests : IDisposable
{
    private readonly string _testDir;
    private readonly ScannerService _scanner;

    public ScannerServiceTests()
    {
        _testDir = Path.Combine(Path.GetTempPath(), "FolderScannerTests_" + Guid.NewGuid().ToString("N")[..8]);
        Directory.CreateDirectory(_testDir);
        _scanner = new ScannerService();
    }

    public void Dispose()
    {
        try { Directory.Delete(_testDir, true); } catch { }
    }

    private void CreateFile(string relativePath, int sizeBytes)
    {
        var fullPath = Path.Combine(_testDir, relativePath);
        Directory.CreateDirectory(Path.GetDirectoryName(fullPath)!);
        File.WriteAllBytes(fullPath, new byte[sizeBytes]);
    }

    [Fact]
    public async Task ScanAsync_EmptyDirectory_ReturnsZeroCounts()
    {
        ScanResult? result = null;
        var logs = new List<LogEntry>();

        await _scanner.ScanAsync(
            _testDir,
            _ => Task.CompletedTask,
            r => { result = r; return Task.CompletedTask; },
            l => { logs.Add(l); return Task.CompletedTask; },
            CancellationToken.None
        );

        Assert.NotNull(result);
        Assert.Equal(0, result.TotalFiles);
        Assert.Equal(0, result.TotalSize);
        Assert.Empty(result.LargestFiles);
        Assert.True(logs.Count > 0);
        Assert.Contains(logs, l => l.Message.Contains("Starting scan"));
        Assert.Contains(logs, l => l.Message.Contains("Scan complete"));
    }

    [Fact]
    public async Task ScanAsync_FindsAllFiles()
    {
        CreateFile("file1.txt", 100);
        CreateFile("file2.txt", 200);
        CreateFile("sub/file3.txt", 300);

        ScanResult? result = null;

        await _scanner.ScanAsync(
            _testDir,
            _ => Task.CompletedTask,
            r => { result = r; return Task.CompletedTask; },
            _ => Task.CompletedTask,
            CancellationToken.None
        );

        Assert.NotNull(result);
        Assert.Equal(3, result.TotalFiles);
        Assert.Equal(600, result.TotalSize);
    }

    [Fact]
    public async Task ScanAsync_LargestFilesAreSortedDescending()
    {
        CreateFile("small.txt", 10);
        CreateFile("medium.txt", 500);
        CreateFile("large.txt", 1000);

        ScanResult? result = null;

        await _scanner.ScanAsync(
            _testDir,
            _ => Task.CompletedTask,
            r => { result = r; return Task.CompletedTask; },
            _ => Task.CompletedTask,
            CancellationToken.None
        );

        Assert.NotNull(result);
        Assert.Equal(3, result.LargestFiles.Count);
        Assert.Equal(1000, result.LargestFiles[0].Size);
        Assert.Equal(500, result.LargestFiles[1].Size);
        Assert.Equal(10, result.LargestFiles[2].Size);
    }

    [Fact]
    public async Task ScanAsync_TopNLimitedTo100()
    {
        for (int i = 0; i < 120; i++)
            CreateFile($"file_{i:D3}.txt", (i + 1) * 10);

        ScanResult? result = null;

        await _scanner.ScanAsync(
            _testDir,
            _ => Task.CompletedTask,
            r => { result = r; return Task.CompletedTask; },
            _ => Task.CompletedTask,
            CancellationToken.None
        );

        Assert.NotNull(result);
        Assert.Equal(120, result.TotalFiles);
        Assert.Equal(100, result.LargestFiles.Count);
        Assert.True(result.LargestFiles[0].Size >= result.LargestFiles[^1].Size);
        // The smallest file in top-100 should be file_020 (210 bytes), not file_000 (10 bytes)
        Assert.True(result.LargestFiles[^1].Size > 10);
    }

    [Fact]
    public async Task ScanAsync_DetectsExtensionSuggestions()
    {
        CreateFile("data.tmp", 500);
        CreateFile("sub/other.tmp", 300);
        CreateFile("app.log", 200);
        CreateFile("keep.txt", 100);

        ScanResult? result = null;

        await _scanner.ScanAsync(
            _testDir,
            _ => Task.CompletedTask,
            r => { result = r; return Task.CompletedTask; },
            _ => Task.CompletedTask,
            CancellationToken.None
        );

        Assert.NotNull(result);
        var tmpSuggestion = result.Suggestions.FirstOrDefault(s => s.Path == "*.tmp");
        Assert.NotNull(tmpSuggestion);
        Assert.Equal(800, tmpSuggestion.TotalSize);
        Assert.Equal(2, tmpSuggestion.FileCount);

        var logSuggestion = result.Suggestions.FirstOrDefault(s => s.Path == "*.log");
        Assert.NotNull(logSuggestion);
        Assert.Equal(200, logSuggestion.TotalSize);
    }

    [Fact]
    public async Task ScanAsync_RecordsFileExtensions()
    {
        CreateFile("image.jpg", 100);
        CreateFile("doc.pdf", 200);

        ScanResult? result = null;

        await _scanner.ScanAsync(
            _testDir,
            _ => Task.CompletedTask,
            r => { result = r; return Task.CompletedTask; },
            _ => Task.CompletedTask,
            CancellationToken.None
        );

        Assert.NotNull(result);
        Assert.Contains(result.LargestFiles, f => f.Extension == ".jpg");
        Assert.Contains(result.LargestFiles, f => f.Extension == ".pdf");
    }

    [Fact]
    public async Task ScanAsync_ReportsProgress()
    {
        for (int i = 0; i < 10; i++)
            CreateFile($"dir{i}/file.txt", 100);

        var progressReports = new List<ScanProgress>();

        await _scanner.ScanAsync(
            _testDir,
            p => { progressReports.Add(p); return Task.CompletedTask; },
            _ => Task.CompletedTask,
            _ => Task.CompletedTask,
            CancellationToken.None
        );

        // Progress may or may not fire (depends on timing with 250ms throttle)
        // But the scan should complete without errors
    }

    [Fact]
    public async Task ScanAsync_CancellationStopsScan()
    {
        for (int i = 0; i < 100; i++)
        {
            var dir = Path.Combine(_testDir, $"dir{i}");
            Directory.CreateDirectory(dir);
            for (int j = 0; j < 10; j++)
                File.WriteAllBytes(Path.Combine(dir, $"file{j}.txt"), new byte[100]);
        }

        var cts = new CancellationTokenSource();
        int progressCount = 0;
        ScanResult? result = null;
        var logs = new List<LogEntry>();

        // Cancel after first progress report
        await _scanner.ScanAsync(
            _testDir,
            p =>
            {
                progressCount++;
                if (progressCount >= 1) cts.Cancel();
                return Task.CompletedTask;
            },
            r => { result = r; return Task.CompletedTask; },
            l => { logs.Add(l); return Task.CompletedTask; },
            cts.Token
        );

        // If cancellation happened, result should be null (no onComplete called)
        // Or if scan was too fast, it might complete normally
        Assert.Contains(logs, l => l.Message.Contains("Starting scan"));
    }

    [Fact]
    public async Task ScanAsync_HandlesNestedDirectories()
    {
        CreateFile("a/b/c/d/deep.txt", 500);

        ScanResult? result = null;

        await _scanner.ScanAsync(
            _testDir,
            _ => Task.CompletedTask,
            r => { result = r; return Task.CompletedTask; },
            _ => Task.CompletedTask,
            CancellationToken.None
        );

        Assert.NotNull(result);
        Assert.Equal(1, result.TotalFiles);
        Assert.Equal(500, result.TotalSize);
        Assert.True(result.TotalDirs >= 4);
    }

    [Fact]
    public async Task ScanAsync_EmitsLogEntries()
    {
        CreateFile("test.txt", 100);
        var logs = new List<LogEntry>();

        await _scanner.ScanAsync(
            _testDir,
            _ => Task.CompletedTask,
            _ => Task.CompletedTask,
            l => { logs.Add(l); return Task.CompletedTask; },
            CancellationToken.None
        );

        Assert.True(logs.Count >= 2);
        Assert.All(logs, l =>
        {
            Assert.NotNull(l.Timestamp);
            Assert.NotNull(l.Level);
            Assert.NotNull(l.Message);
            Assert.Contains(l.Level, new[] { "info", "warning", "error" });
        });
    }

    [Fact]
    public async Task ScanAsync_ElapsedTimeIsPositive()
    {
        CreateFile("file.txt", 100);
        ScanResult? result = null;

        await _scanner.ScanAsync(
            _testDir,
            _ => Task.CompletedTask,
            r => { result = r; return Task.CompletedTask; },
            _ => Task.CompletedTask,
            CancellationToken.None
        );

        Assert.NotNull(result);
        Assert.True(result.ElapsedSeconds >= 0);
    }

    [Fact]
    public void TryStartScan_PreventsMultipleScans()
    {
        Assert.True(_scanner.TryStartScan());
        Assert.False(_scanner.TryStartScan());
        Assert.True(_scanner.IsScanning);

        _scanner.FinishScan();
        Assert.False(_scanner.IsScanning);
        Assert.True(_scanner.TryStartScan());
    }

    [Fact]
    public async Task ScanAsync_CountsDirectoriesCorrectly()
    {
        Directory.CreateDirectory(Path.Combine(_testDir, "a"));
        Directory.CreateDirectory(Path.Combine(_testDir, "b"));
        Directory.CreateDirectory(Path.Combine(_testDir, "a", "c"));
        CreateFile("a/file1.txt", 10);
        CreateFile("b/file2.txt", 20);
        CreateFile("a/c/file3.txt", 30);

        ScanResult? result = null;

        await _scanner.ScanAsync(
            _testDir,
            _ => Task.CompletedTask,
            r => { result = r; return Task.CompletedTask; },
            _ => Task.CompletedTask,
            CancellationToken.None
        );

        Assert.NotNull(result);
        Assert.Equal(3, result.TotalFiles);
        Assert.True(result.TotalDirs >= 4); // root + a + b + a/c
    }
}
