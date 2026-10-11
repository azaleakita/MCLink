using System.Security.Cryptography;
using System.Text.Json;
using MCLink.App.Models;

namespace MCLink.App.Services;
public static class SettingsStore
{
    public static string DataDirectory { get; } = Environment.GetEnvironmentVariable("MCLINK_DATA_DIR") is { Length: > 0 } custom
        ? Path.GetFullPath(custom)
        : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MCLink");
    private static string FilePath => Path.Combine(DataDirectory, "settings.bin");
    public static JsonSerializerOptions JsonOptions { get; } = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, PropertyNameCaseInsensitive = true };
    public static AppSettings Load()
    {
        if (!File.Exists(FilePath)) return new AppSettings();
        var decrypted = ProtectedData.Unprotect(File.ReadAllBytes(FilePath), null, DataProtectionScope.CurrentUser);
        try { return JsonSerializer.Deserialize<AppSettings>(decrypted, JsonOptions) ?? new AppSettings(); }
        finally { CryptographicOperations.ZeroMemory(decrypted); }
    }
    public static void Save(AppSettings settings)
    {
        Directory.CreateDirectory(DataDirectory);
        var plaintext = JsonSerializer.SerializeToUtf8Bytes(settings, JsonOptions);
        try
        {
            var encrypted = ProtectedData.Protect(plaintext, null, DataProtectionScope.CurrentUser);
            var temporary = FilePath + ".tmp";
            File.WriteAllBytes(temporary, encrypted);
            File.Move(temporary, FilePath, true);
        }
        finally { CryptographicOperations.ZeroMemory(plaintext); }
    }
}
