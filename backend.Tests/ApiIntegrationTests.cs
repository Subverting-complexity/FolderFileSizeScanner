using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using FolderFileSizeScanner;

namespace backend.Tests;

public class ApiIntegrationTests : IClassFixture<WebApplicationFactory<Program>>, IDisposable
{
    private readonly WebApplicationFactory<Program> _factory;
    private readonly HttpClient _client;
    private readonly string _testDir;
    private readonly ScannerService _scanner;

    public ApiIntegrationTests(WebApplicationFactory<Program> factory)
    {
        _factory = factory;
        _client = _factory.CreateClient();
        _testDir = Path.Combine(Path.GetTempPath(), "FolderScannerApiTests_" + Guid.NewGuid().ToString("N")[..8]);
        Directory.CreateDirectory(_testDir);
        _scanner = _factory.Services.GetRequiredService<ScannerService>();
    }

    public void Dispose()
    {
        _client.Dispose();
        try { Directory.Delete(_testDir, true); } catch { }
    }

    private void CreateFile(string relativePath, int sizeBytes)
    {
        var fullPath = Path.Combine(_testDir, relativePath);
        Directory.CreateDirectory(Path.GetDirectoryName(fullPath)!);
        File.WriteAllBytes(fullPath, new byte[sizeBytes]);
    }

    private async Task<string> ScanAndReadFull(string path)
    {
        var response = await _client.GetAsync($"/api/scan?path={Uri.EscapeDataString(path)}",
            HttpCompletionOption.ResponseHeadersRead);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadAsStringAsync();
    }

    private async Task WaitForScanLock(int maxWaitMs = 5000)
    {
        var sw = System.Diagnostics.Stopwatch.StartNew();
        while (_scanner.IsScanning && sw.ElapsedMilliseconds < maxWaitMs)
            await Task.Delay(50);
    }

    [Fact]
    public async Task GetDrives_ReturnsOkWithDriveList()
    {
        var response = await _client.GetAsync("/api/drives");
        response.EnsureSuccessStatusCode();

        var content = await response.Content.ReadAsStringAsync();
        var drives = JsonSerializer.Deserialize<List<DriveInfoModel>>(content,
            new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });

        Assert.NotNull(drives);
        Assert.NotEmpty(drives);
        Assert.All(drives, d =>
        {
            Assert.True(d.IsReady);
            Assert.Single(d.Letter);
            Assert.True(char.IsLetter(d.Letter[0]));
            Assert.True(d.TotalSize > 0);
            Assert.True(d.FreeSpace >= 0);
        });
    }

    [Fact]
    public async Task GetDrives_DriveLetterIsSingleChar()
    {
        var response = await _client.GetAsync("/api/drives");
        var content = await response.Content.ReadAsStringAsync();
        var drives = JsonSerializer.Deserialize<List<DriveInfoModel>>(content,
            new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });

        Assert.NotNull(drives);
        foreach (var drive in drives)
        {
            Assert.Equal(1, drive.Letter.Length);
            Assert.DoesNotContain(":", drive.Letter);
        }
    }

    [Fact]
    public async Task Scan_InvalidPath_Returns400()
    {
        await WaitForScanLock();
        var response = await _client.GetAsync("/api/scan?path=Z:\\NonExistent\\Path\\12345");
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Scan_ValidPath_ReturnsSSEStream()
    {
        await WaitForScanLock();
        CreateFile("test.txt", 100);
        CreateFile("sub/test2.txt", 200);

        var content = await ScanAndReadFull(_testDir);

        Assert.Contains("event: log", content);
        Assert.Contains("event: complete", content);
        Assert.Contains("\"totalFiles\":2", content);
    }

    [Fact]
    public async Task Scan_EmptyDirectory_ReturnsZeroCounts()
    {
        await WaitForScanLock();
        var emptyDir = Path.Combine(_testDir, "empty");
        Directory.CreateDirectory(emptyDir);

        var content = await ScanAndReadFull(emptyDir);

        Assert.Contains("\"totalFiles\":0", content);
        Assert.Contains("\"totalSize\":0", content);
    }

    [Fact]
    public async Task Scan_ContainsLogEvents()
    {
        await WaitForScanLock();
        CreateFile("file.txt", 50);

        var content = await ScanAndReadFull(_testDir);

        Assert.Contains("event: log", content);
        Assert.Contains("Starting scan", content);
        Assert.Contains("Scan complete", content);
    }

    [Fact]
    public async Task Scan_MissingPathParam_Returns400()
    {
        var response = await _client.GetAsync("/api/scan");
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Scan_DetectsTmpExtensionSuggestions()
    {
        await WaitForScanLock();
        CreateFile("data.tmp", 500);
        CreateFile("other.tmp", 300);

        var content = await ScanAndReadFull(_testDir);

        Assert.Contains(".tmp", content);
        Assert.Contains("\"fileCount\":2", content);
    }

    [Fact]
    public async Task Scan_ResponseContentTypeIsSSE()
    {
        await WaitForScanLock();
        CreateFile("check.txt", 10);

        var response = await _client.GetAsync($"/api/scan?path={Uri.EscapeDataString(_testDir)}",
            HttpCompletionOption.ResponseHeadersRead);

        response.EnsureSuccessStatusCode();
        Assert.Equal("text/event-stream", response.Content.Headers.ContentType?.MediaType);

        await response.Content.ReadAsStringAsync();
    }
}
