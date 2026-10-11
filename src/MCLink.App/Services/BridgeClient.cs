using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text;
using System.Text.Json;

namespace MCLink.App.Services;
public sealed class BridgeClient : IDisposable
{
    private Process? _process;
    private readonly ConcurrentDictionary<string, TaskCompletionSource<JsonElement>> _pending = new();
    private readonly SemaphoreSlim _writeLock = new(1, 1);
    private bool _disposed;
    public event Action<string, JsonElement>? EventReceived;
    public event Action<string>? Failed;
    public async Task StartAsync()
    {
        var folder = FindBridge();
        var bundledNode = Path.Combine(AppContext.BaseDirectory, "runtime", "node.exe");
        var info = new ProcessStartInfo(File.Exists(bundledNode) ? bundledNode : "node.exe")
        {
            WorkingDirectory = folder, UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
            StandardInputEncoding = new UTF8Encoding(false), StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8
        };
        info.ArgumentList.Add(Path.Combine(folder, "src", "server.mjs"));
        info.Environment["MCLINK_DATA_DIR"] = SettingsStore.DataDirectory;
        _process = Process.Start(info) ?? throw new InvalidOperationException("无法启动 Node.js 桥接进程。");
        _ = ReadOutputAsync(_process);
        // Diagnostics can contain provider internals. Drain them without adding them to UI logs.
        _ = _process.StandardError.ReadToEndAsync();
        await SendAsync("hello", new { }, TimeSpan.FromSeconds(15));
    }
    private static string FindBridge()
    {
        var packaged = Path.Combine(AppContext.BaseDirectory, "bridge");
        if (File.Exists(Path.Combine(packaged, "src", "server.mjs")) && Directory.Exists(Path.Combine(packaged, "node_modules"))) return packaged;
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null)
        {
            var candidate = Path.Combine(directory.FullName, "bridge");
            if (File.Exists(Path.Combine(candidate, "src", "server.mjs")) && Directory.Exists(Path.Combine(candidate, "node_modules"))) return candidate;
            directory = directory.Parent;
        }
        throw new FileNotFoundException("找不到桥接程序或依赖，请运行项目根目录下的 build.ps1。");
    }
    private async Task ReadOutputAsync(Process process)
    {
        try
        {
            while (await process.StandardOutput.ReadLineAsync() is { } line)
            {
                JsonElement root;
                try { using var document = JsonDocument.Parse(line); root = document.RootElement.Clone(); } catch (JsonException) { continue; }
                var kind = root.GetProperty("kind").GetString();
                if (kind == "response")
                {
                    var id = root.GetProperty("id").GetString()!;
                    if (_pending.TryRemove(id, out var tcs))
                    {
                        if (root.GetProperty("ok").GetBoolean()) tcs.TrySetResult(root.GetProperty("result").Clone());
                        else tcs.TrySetException(new InvalidOperationException(root.GetProperty("error").GetString()));
                    }
                }
                else if (kind == "event") EventReceived?.Invoke(root.GetProperty("event").GetString()!, root.GetProperty("data").Clone());
            }
            if (!_disposed) throw new IOException("游戏桥接进程已退出，请重启 MCLink。");
        }
        catch (Exception error)
        {
            foreach (var entry in _pending) if (_pending.TryRemove(entry.Key, out var pending)) pending.TrySetException(error);
            if (!_disposed) Failed?.Invoke(error.Message);
        }
    }
    public async Task<JsonElement> SendAsync(string type, object payload, TimeSpan? timeout = null)
    {
        if (_process is null || _process.HasExited) throw new InvalidOperationException("桥接进程未运行，请检查 Node.js 和项目依赖。");
        var id = Guid.NewGuid().ToString("N");
        var tcs = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        _pending[id] = tcs;
        try
        {
            var line = JsonSerializer.Serialize(new { id, type, payload }, SettingsStore.JsonOptions);
            await _writeLock.WaitAsync();
            try { await _process.StandardInput.WriteLineAsync(line); await _process.StandardInput.FlushAsync(); }
            finally { _writeLock.Release(); }
            var defaultTimeout = type is "chat_generate" or "api_test" or "api_models" ? TimeSpan.FromMinutes(10) : TimeSpan.FromSeconds(135);
            return await tcs.Task.WaitAsync(timeout ?? defaultTimeout);
        }
        finally { _pending.TryRemove(id, out _); }
    }
    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        if (_process is not null)
        {
            try
            {
                _process.StandardInput.Close();
                if (!_process.WaitForExit(1500)) _process.Kill(entireProcessTree: true);
            }
            catch (InvalidOperationException) { }
            _process.Dispose();
        }
        foreach (var entry in _pending) entry.Value.TrySetCanceled();
        _pending.Clear();
    }
}
