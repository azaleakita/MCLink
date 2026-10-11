using System.Text;
using System.Text.Json;
using System.Threading.Channels;

namespace MCLink.App.Services;

// Receives already-redacted UI messages; disk I/O stays off the UI thread.
public sealed class LogStore : IDisposable
{
    private sealed record Entry(DateTimeOffset Time, string Category, string Message);
    private readonly Channel<Entry> _queue = Channel.CreateBounded<Entry>(new BoundedChannelOptions(2048)
    { SingleReader = true, FullMode = BoundedChannelFullMode.DropOldest });
    private readonly Task _writer;
    public string DirectoryPath { get; }
    public event Action<string>? Failed;

    public LogStore(string dataDirectory)
    {
        DirectoryPath = Path.Combine(dataDirectory, "logs");
        _writer = Task.Run(WriteAsync);
    }
    public void Append(string category, string redactedMessage) =>
        _queue.Writer.TryWrite(new Entry(DateTimeOffset.Now, category, redactedMessage));

    private async Task WriteAsync()
    {
        string day = "";
        int part = 0;
        try
        {
            await foreach (var entry in _queue.Reader.ReadAllAsync())
            {
                var date = entry.Time.ToString("yyyy-MM-dd");
                if (date != day)
                {
                    Directory.CreateDirectory(DirectoryPath);
                    foreach (var old in Directory.EnumerateFiles(DirectoryPath, "mclink-*.log"))
                    {
                        try { if (File.GetLastWriteTimeUtc(old) < DateTime.UtcNow.AddDays(-14)) File.Delete(old); }
                        catch (IOException) { /* Another instance or viewer may hold an older file. */ }
                        catch (UnauthorizedAccessException) { }
                    }
                    day = date; part = 0;
                }
                var path = Path.Combine(DirectoryPath, $"mclink-{day}-{Environment.ProcessId}-{part}.log");
                while (File.Exists(path) && new FileInfo(path).Length >= 10 * 1024 * 1024)
                    path = Path.Combine(DirectoryPath, $"mclink-{day}-{Environment.ProcessId}-{++part}.log");
                await File.AppendAllTextAsync(path, JsonSerializer.Serialize(entry, new JsonSerializerOptions
                { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping }) + "\n", new UTF8Encoding(false));
            }
        }
        catch (Exception)
        {
            _queue.Writer.TryComplete();
            Failed?.Invoke("日志文件写入失败，可继续使用窗口中的行动记录。");
        }
    }
    public void Dispose()
    {
        _queue.Writer.TryComplete();
        _writer.Wait(TimeSpan.FromSeconds(2));
    }
}
