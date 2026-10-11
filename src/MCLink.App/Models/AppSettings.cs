namespace MCLink.App.Models;

public sealed class ApiProfile
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Name { get; set; } = "自定义 API";
    public string Protocol { get; set; } = "openai";
    public string BaseUrl { get; set; } = "";
    public string Model { get; set; } = "";
    public string ApiKey { get; set; } = "";
    public string HeadersJson { get; set; } = "{}";
    public int MaxTokens { get; set; } = 2048;
    public double Temperature { get; set; } = 0.4;
    public double RequestIntervalSeconds { get; set; } = 8;
    public string Subtitle => $"{Model} · {Protocol}";
}
public sealed class ConnectionSettings
{
    public string WorldId { get; set; } = "";
    public string Host { get; set; } = "localhost";
    public int Port { get; set; } = 25565;
    public string Username { get; set; } = "MCLinkBot";
    public string Auth { get; set; } = "offline";
    public string Version { get; set; } = "";
}
public sealed class AgentPreferences
{
    public int MaxSteps { get; set; } = 80;
    public int BatchSize { get; set; } = 4;
    public double IntervalSeconds { get; set; } = 2;
    public int StopHealth { get; set; } = 4;
    public bool AutoEat { get; set; } = true;
    public bool ChatEnabled { get; set; } = true;
    public bool AutoReplyChat { get; set; } = true;
    public double ChatIntervalSeconds { get; set; } = 8;
    public string ChatPrompt { get; set; } = "";
    public string CustomPrompt { get; set; } = "";
}
public sealed class AppSettings
{
    public List<ApiProfile> Profiles { get; set; } = [];
    public string? ActiveProfileId { get; set; }
    public ConnectionSettings Connection { get; set; } = new();
    public AgentPreferences Preferences { get; set; } = new();
    public string Theme { get; set; } = "Default";
    public string LastGoal { get; set; } = "采集 8 个橡木原木，制作工作台和木镐。";
    public string IconDirectory { get; set; } = "";
    public string MapWorldId { get; set; } = "";
    public string ImportVersion { get; set; } = "";
    public int MapSize { get; set; } = 256;
}
public sealed record InventoryRow(string Name, string DisplayName, int Count, int Slot, Microsoft.UI.Xaml.Media.ImageSource? Icon = null)
{
    public string CountText => $"× {Count}";
    public string SlotText => $"槽位 {Slot}";
}
public sealed record LogRow(string Time, string Category, string Message);
