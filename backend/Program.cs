using System.Text.Json;
using FolderFileSizeScanner;

// Single-instance enforcement via named mutex
Mutex? mutex = null;
var isTestHost = AppDomain.CurrentDomain.GetAssemblies()
    .Any(a => a.GetName().Name == "Microsoft.AspNetCore.Mvc.Testing");
if (!isTestHost)
{
    mutex = new Mutex(true, "Global\\FolderFileSizeScannerInstance", out bool createdNew);
    if (!createdNew)
    {
        mutex.Dispose();
        Console.Error.WriteLine("Another instance of Folder & File Size Scanner is already running.");
        Console.Error.WriteLine("Only one instance is allowed at a time.");
        Environment.Exit(1);
        return;
    }
}

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddSingleton<ScannerService>();
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy => policy.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader());
});

var app = builder.Build();
app.UseCors();
app.UseDefaultFiles();
app.UseStaticFiles();

var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

app.MapGet("/api/drives", () =>
{
    var drives = DriveInfo.GetDrives()
        .Where(d => d.IsReady)
        .Select(d => new DriveInfoModel(
            d.Name[..1],
            d.VolumeLabel,
            d.DriveType.ToString(),
            d.TotalSize,
            d.AvailableFreeSpace,
            d.IsReady
        ))
        .ToList();
    return Results.Json(drives, jsonOptions);
});

app.MapGet("/api/scan", async (HttpContext ctx, string path, ScannerService scanner) =>
{
    var normalizedPath = path.Trim();
    if (normalizedPath.Length == 1 && char.IsLetter(normalizedPath[0]))
        normalizedPath += @":\";
    else if (normalizedPath.Length == 2 && normalizedPath[1] == ':')
        normalizedPath += @"\";
    else if (!normalizedPath.EndsWith('\\') && normalizedPath.Length <= 3)
        normalizedPath += @"\";

    if (!Directory.Exists(normalizedPath))
    {
        ctx.Response.StatusCode = 400;
        await ctx.Response.WriteAsync($"Path not found: {normalizedPath}");
        return;
    }

    if (!scanner.TryStartScan())
    {
        ctx.Response.StatusCode = 409;
        await ctx.Response.WriteAsync("A scan is already in progress. Please wait for it to complete or cancel it.");
        return;
    }

    try
    {
        ctx.Response.Headers.ContentType = "text/event-stream";
        ctx.Response.Headers.CacheControl = "no-cache";
        ctx.Response.Headers.Connection = "keep-alive";

        var ct = ctx.RequestAborted;

        async Task SendEvent(string eventType, object data)
        {
            var json = JsonSerializer.Serialize(data, jsonOptions);
            await ctx.Response.WriteAsync($"event: {eventType}\ndata: {json}\n\n", ct);
            await ctx.Response.Body.FlushAsync(ct);
        }

        try
        {
            await scanner.ScanAsync(
                normalizedPath,
                progress => SendEvent("progress", progress),
                result => SendEvent("complete", result),
                log => SendEvent("log", log),
                ct
            );
        }
        catch (OperationCanceledException) { }
    }
    finally
    {
        scanner.FinishScan();
    }
});

// Cancel active scans on shutdown
app.Lifetime.ApplicationStopping.Register(() =>
{
    Console.WriteLine("Application shutting down, cancelling active scans...");
});

var url = app.Urls.FirstOrDefault() ?? "http://localhost:5000";

app.Lifetime.ApplicationStarted.Register(() =>
{
    if (!app.Environment.IsDevelopment())
    {
        try
        {
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
            {
                FileName = url,
                UseShellExecute = true
            });
        }
        catch { }
    }
});

app.Run();
mutex?.ReleaseMutex();
mutex?.Dispose();

public partial class Program { }
