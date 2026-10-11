using System.Collections.ObjectModel;
using System.Text.Json;
using MCLink.App.Models;
using MCLink.App.Services;
using Microsoft.UI;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using Windows.UI;

namespace MCLink.App;
public sealed partial class MainWindow : Window
{
    private readonly BridgeClient _bridge = new();
    private readonly LogStore _logStore = new(SettingsStore.DataDirectory);
    private AppSettings _settings = new();
    private readonly ObservableCollection<ApiProfile> _profiles = [];
    private readonly ObservableCollection<InventoryRow> _inventory = [];
    private readonly ObservableCollection<LogRow> _logs = [];
    private readonly List<Rectangle> _tiles = [];
    private readonly Dictionary<string, SolidColorBrush> _mapBrushes = [];
    private string? _editingId;
    private bool _initialized, _bridgeReady, _connected, _agentRunning, _connecting;
    private int _modelListRevision;
    private bool _readingModels;

    public MainWindow()
    {
        InitializeComponent();
        ExtendsContentIntoTitleBar = true;
        SetTitleBar(TitleBar);
        var initialSize = new Windows.Graphics.SizeInt32(1360, 1000);
        var diagnosticSize = Environment.GetEnvironmentVariable("MCLINK_WINDOW_SIZE")?.Split('x');
        if (Environment.GetEnvironmentVariable("MCLINK_DIAGNOSTICS") == "1" && diagnosticSize?.Length == 2 &&
            int.TryParse(diagnosticSize[0], out var width) && int.TryParse(diagnosticSize[1], out var height) &&
            width is >= 800 and <= 4000 && height is >= 600 and <= 2400) initialSize = new Windows.Graphics.SizeInt32(width, height);
        AppWindow.Resize(initialSize);
        AppWindow.Title = "MCLink · Minecraft AI 工作台";
        var icon = System.IO.Path.Combine(AppContext.BaseDirectory, "Assets", "MCLink.ico");
        if (System.IO.File.Exists(icon)) AppWindow.SetIcon(icon);
        Closed += (_, _) => { AddLog("info", "应用已关闭。"); _bridge.Dispose(); _logStore.Dispose(); };
        _logStore.Failed += message => DispatcherQueue.TryEnqueue(() => ShowNotice(message, InfoBarSeverity.Warning));
        _bridge.EventReceived += (name, data) => DispatcherQueue.TryEnqueue(() => HandleEvent(name, data));
        _bridge.Failed += message => DispatcherQueue.TryEnqueue(() =>
        {
            _bridgeReady = false; _connected = false; _connecting = false; _agentRunning = false; _chatGenerating = false;
            ConnectionStateText.Text = "桥接进程已退出"; ConnectionDetailText.Text = message;
            UpdateButtons(); ShowNotice(message, InfoBarSeverity.Error);
        });
    }
    private async void Root_Loaded(object sender, RoutedEventArgs e)
    {
        if (_initialized) return;
        _initialized = true;
        try { _settings = SettingsStore.Load(); }
        catch (Exception) { ShowNotice("配置无法解密或已损坏。已载入默认设置；保存后将创建新配置。", InfoBarSeverity.Warning); }
        foreach (var profile in _settings.Profiles) _profiles.Add(profile);
        ProfilesList.ItemsSource = _profiles; ActiveProfileCombo.ItemsSource = _profiles;
        InventoryList.ItemsSource = _inventory; LogsList.ItemsSource = _logs;
        ActiveProfileCombo.SelectedItem = _profiles.FirstOrDefault(p => p.Id == _settings.ActiveProfileId) ?? _profiles.FirstOrDefault();
        if (_profiles.Count > 0) ProfilesList.SelectedItem = ActiveProfileCombo.SelectedItem;
        else FillProfile(new ApiProfile());
        GoalBox.Text = _settings.LastGoal;
        HostBox.Text = _settings.Connection.Host; PortBox.Value = _settings.Connection.Port;
        UsernameBox.Text = _settings.Connection.Username; VersionBox.Text = _settings.Connection.Version;
        SelectTag(AuthCombo, _settings.Connection.Auth);
        MaxStepsBox.Value = _settings.Preferences.MaxSteps; IntervalBox.Value = _settings.Preferences.IntervalSeconds;
        BatchSizeBox.Value = _settings.Preferences.BatchSize;
        StopHealthBox.Value = _settings.Preferences.StopHealth; AutoEatSwitch.IsOn = _settings.Preferences.AutoEat;
        ChatEnabledSwitch.IsOn = _settings.Preferences.ChatEnabled; AutoReplyChatSwitch.IsOn = _settings.Preferences.AutoReplyChat;
        ChatIntervalBox.Value = _settings.Preferences.ChatIntervalSeconds; ChatPromptBox.Text = _settings.Preferences.ChatPrompt;
        CustomPromptBox.Text = _settings.Preferences.CustomPrompt;
        SelectTag(ThemeCombo, _settings.Theme); ApplyTheme();
        DataPathText.Text = $"本地配置与账号缓存：{SettingsStore.DataDirectory}";
        InitializeMap(); UpdateButtons();
        try
        {
            await _bridge.StartAsync(); await InitializeChatAsync(); await InitializeMapFeaturesAsync(); _bridgeReady = true; await SyncGameChatAsync(); UpdateButtons();
            AddLog("info", "桥接程序就绪。先添加 API，再连接 Minecraft 世界。");
        }
        catch (Exception error) { ShowNotice(error.Message, InfoBarSeverity.Error); AddLog("error", error.Message); }
    }
    private void Navigation_SelectionChanged(NavigationView sender, NavigationViewSelectionChangedEventArgs args)
    {
        if (args.SelectedItem is NavigationViewItem item) ShowPanel(item.Tag?.ToString() ?? "dashboard");
    }
    private void ShowPanel(string name)
    {
        if (DashboardPanel is null) return;
        DashboardPanel.Visibility = name == "dashboard" ? Visibility.Visible : Visibility.Collapsed;
        ApiPanel.Visibility = name == "api" ? Visibility.Visible : Visibility.Collapsed;
        WorldMapPanel.Visibility = name == "map" ? Visibility.Visible : Visibility.Collapsed;
        ConnectionPanel.Visibility = name == "connection" ? Visibility.Visible : Visibility.Collapsed;
        SettingsPanel.Visibility = name == "settings" ? Visibility.Visible : Visibility.Collapsed;
        HelpPanel.Visibility = name == "help" ? Visibility.Visible : Visibility.Collapsed;
        if (name == "map" && _mapReady) _ = RefreshMapQuietly();
        if (name == "api") { UpdateApiLayout(); _ = CaptureApiLayoutAsync(); }
        if (name == "settings") UpdateSettingsLayout();
        if (name is "settings" or "dashboard") _ = CaptureChatLayoutAsync();
    }
    private void NavigateTo(string tag)
    {
        Navigation.SelectedItem = Navigation.MenuItems.Concat(Navigation.FooterMenuItems).OfType<NavigationViewItem>().FirstOrDefault(i => i.Tag?.ToString() == tag);
        ShowPanel(tag);
    }
    private void ConnectionBadge_Click(object sender, RoutedEventArgs e) => NavigateTo("connection");
    private static string Tag(ComboBox box) => (box.SelectedItem as ComboBoxItem)?.Tag?.ToString() ?? "";
    private static void SelectTag(ComboBox box, string tag) => box.SelectedItem = box.Items.OfType<ComboBoxItem>().FirstOrDefault(i => i.Tag?.ToString() == tag) ?? box.Items[0];
    private void ShowNotice(string message, InfoBarSeverity severity = InfoBarSeverity.Informational)
    {
        Notice.Message = Redact(message); Notice.Severity = severity; Notice.IsOpen = true;
    }
    private string Redact(string message)
    {
        var secrets = _profiles.Select(p => p.ApiKey).ToList();
        if (ApiKeyBox is not null) secrets.Add(ApiKeyBox.Password);
        foreach (var profile in _profiles)
        {
            if (string.IsNullOrWhiteSpace(profile.HeadersJson)) continue;
            try
            {
                using var headers = JsonDocument.Parse(profile.HeadersJson);
                if (headers.RootElement.ValueKind == JsonValueKind.Object)
                    foreach (var header in headers.RootElement.EnumerateObject())
                        if (header.Value.ValueKind == JsonValueKind.String && header.Value.GetString() is { Length: >= 8 } secret) secrets.Add(secret);
            }
            catch (JsonException) { }
        }
        foreach (var secret in secrets.Where(s => !string.IsNullOrWhiteSpace(s)).Distinct().OrderByDescending(s => s.Length))
            message = message.Replace(secret, "[密钥已隐藏]");
        return message;
    }
    private void AddLog(string level, string message)
    {
        var category = level switch { "model" => "模型", "action" => "行动", "game" => "游戏", "chat" => "发言", "error" => "错误", _ => "系统" };
        var redacted = Redact(message);
        _logs.Insert(0, new LogRow(DateTime.Now.ToString("HH:mm:ss"), category, redacted));
        _logStore.Append(category, redacted);
        while (_logs.Count > 300) _logs.RemoveAt(_logs.Count - 1);
    }
    private async Task Guard(Func<Task> action)
    {
        try { await action(); }
        catch (Exception error) { ShowNotice(error.Message, InfoBarSeverity.Error); AddLog("error", error.Message); }
    }
    private void Persist()
    {
        _settings.Profiles = _profiles.ToList();
        SettingsStore.Save(_settings);
    }
    private static int ReadInteger(NumberBox box, int min, int max, string name)
    {
        var value = box.Value;
        if (!double.IsFinite(value) || value != Math.Truncate(value) || value < min || value > max) throw new InvalidOperationException($"{name}需为 {min}–{max} 的整数。");
        return (int)value;
    }
    private ApiProfile ReadProfile(bool forModelList = false)
    {
        if (!forModelList && string.IsNullOrWhiteSpace(ProfileNameBox.Text)) throw new InvalidOperationException("请填写连接名称。");
        if (!forModelList && string.IsNullOrWhiteSpace(ModelBox.Text)) throw new InvalidOperationException("请填写模型名称。");
        if (!Uri.TryCreate(BaseUrlBox.Text.Trim(), UriKind.Absolute, out var uri) || (uri.Scheme != "https" && uri.Scheme != "http") || !string.IsNullOrEmpty(uri.UserInfo) || !string.IsNullOrEmpty(uri.Query) || !string.IsNullOrEmpty(uri.Fragment)) throw new InvalidOperationException("请填写完整 API 地址，不含账号、查询参数或片段。");
        using var headers = JsonDocument.Parse(string.IsNullOrWhiteSpace(HeadersBox.Text) ? "{}" : HeadersBox.Text);
        if (headers.RootElement.ValueKind != JsonValueKind.Object || headers.RootElement.EnumerateObject().Any(p => p.Value.ValueKind != JsonValueKind.String)) throw new InvalidOperationException("额外请求头必须是键和值均为字符串的 JSON 对象。");
        if (!double.IsFinite(TemperatureBox.Value) || TemperatureBox.Value < 0 || TemperatureBox.Value > 2) throw new InvalidOperationException("温度需在 0–2 之间。");
        if (!double.IsFinite(RequestIntervalBox.Value) || RequestIntervalBox.Value < 0 || RequestIntervalBox.Value > 120) throw new InvalidOperationException("API 请求间隔需在 0–120 秒之间。");
        return new ApiProfile { Id = _editingId ?? Guid.NewGuid().ToString("N"), Name = ProfileNameBox.Text.Trim(), Protocol = Tag(ProtocolCombo), BaseUrl = BaseUrlBox.Text.Trim(), Model = ModelBox.Text.Trim(), ApiKey = ApiKeyBox.Password.Trim(), HeadersJson = headers.RootElement.GetRawText(), MaxTokens = ReadInteger(MaxTokensBox, 256, 32768, "输出 tokens"), Temperature = TemperatureBox.Value, RequestIntervalSeconds = RequestIntervalBox.Value };
    }
    private void FillProfile(ApiProfile profile)
    {
        ProfileNameBox.Text = profile.Name; SelectTag(ProtocolCombo, profile.Protocol);
        BaseUrlBox.Text = profile.BaseUrl; ModelBox.Text = profile.Model; ApiKeyBox.Password = profile.ApiKey;
        HeadersBox.Text = profile.HeadersJson; MaxTokensBox.Value = profile.MaxTokens; TemperatureBox.Value = profile.Temperature;
        RequestIntervalBox.Value = profile.RequestIntervalSeconds;
        ClearModelList();
        ProfileEditorTitle.Text = _editingId is null ? "添加模型连接" : "编辑模型连接";
        DeleteProfileButton.IsEnabled = _editingId is not null;
        ApiResultText.Text = "保存后，可在工作台选择这个模型。";
    }
    private void ProfilesList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (ProfilesList.SelectedItem is ApiProfile profile) { _editingId = profile.Id; FillProfile(profile); }
    }
    private void AddProfile_Click(object sender, RoutedEventArgs e)
    {
        ProfilesList.SelectedItem = null; _editingId = null; FillProfile(new ApiProfile()); PresetCombo.SelectedItem = null;
    }
    private async void SaveProfile_Click(object sender, RoutedEventArgs e) => await Guard(() =>
    {
        var profile = ReadProfile();
        var index = _profiles.ToList().FindIndex(p => p.Id == profile.Id);
        var wasActive = _settings.ActiveProfileId == profile.Id;
        if (index >= 0) _profiles[index] = profile; else _profiles.Add(profile);
        _editingId = profile.Id;
        if (wasActive || ActiveProfileCombo.SelectedItem is null) ActiveProfileCombo.SelectedItem = profile;
        ProfilesList.SelectedItem = profile;
        Persist(); ApiResultText.Text = "已加密保存，可在工作台使用。"; ShowNotice("API 连接已保存。", InfoBarSeverity.Success); UpdateButtons();
        return Task.CompletedTask;
    });
    private async void DeleteProfile_Click(object sender, RoutedEventArgs e) => await Guard(() =>
    {
        var profile = _profiles.FirstOrDefault(p => p.Id == _editingId);
        if (profile is not null) _profiles.Remove(profile);
        if (_settings.ActiveProfileId == _editingId) { _settings.ActiveProfileId = _profiles.FirstOrDefault()?.Id; ActiveProfileCombo.SelectedItem = _profiles.FirstOrDefault(); }
        _editingId = null; ProfilesList.SelectedItem = null; FillProfile(new ApiProfile()); Persist(); UpdateButtons();
        return Task.CompletedTask;
    });
    private async void ActiveProfileCombo_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (ActiveProfileCombo.SelectedItem is ApiProfile profile) _settings.ActiveProfileId = profile.Id;
        UpdateButtons();
        if (_bridgeReady) await Guard(SyncGameChatAsync);
    }
    private void PresetCombo_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (ProtocolCombo is null) return;
        switch (Tag(PresetCombo))
        {
            case "deepseek": ProfileNameBox.Text = "DeepSeek"; BaseUrlBox.Text = "https://api.deepseek.com/v1"; ModelBox.Text = ""; SelectTag(ProtocolCombo, "openai"); break;
            case "openai": ProfileNameBox.Text = "OpenAI 兼容 API"; BaseUrlBox.Text = "https://api.openai.com/v1"; ModelBox.Text = ""; SelectTag(ProtocolCombo, "openai"); break;
            case "anthropic": ProfileNameBox.Text = "Anthropic"; BaseUrlBox.Text = "https://api.anthropic.com/v1"; ModelBox.Text = ""; SelectTag(ProtocolCombo, "anthropic"); break;
            case "ollama": ProfileNameBox.Text = "Ollama 本地模型"; BaseUrlBox.Text = "http://localhost:11434"; ModelBox.Text = ""; ApiKeyBox.Password = ""; SelectTag(ProtocolCombo, "ollama"); break;
        }
        RequestIntervalBox.Value = Tag(PresetCombo) == "ollama" ? 0 : 8;
        ClearModelList();
    }
    private void ModelConnection_Changed(object sender, RoutedEventArgs e) => ClearModelList();
    private void ClearModelList()
    {
        _modelListRevision++;
        if (ModelsCombo is null) return;
        ModelsCombo.SelectedItem = null; ModelsCombo.ItemsSource = null; ModelsCombo.Visibility = Visibility.Collapsed;
        if (_readingModels && ApiResultText is not null) ApiResultText.Text = "连接配置已变更，请重新读取模型。";
    }
    private async void TestApiButton_Click(object sender, RoutedEventArgs e)
    {
        TestApiButton.IsEnabled = false; ApiResultText.Text = "正在测试，请稍候…";
        await Guard(async () => { var reply = await _bridge.SendAsync("api_test", ReadProfile()); ApiResultText.Text = $"连接成功 · {reply.GetProperty("latencyMs").GetInt32()} ms"; ShowNotice("模型 API 已返回文本。", InfoBarSeverity.Success); });
        TestApiButton.IsEnabled = _bridgeReady;
    }
    private async void LoadModelsButton_Click(object sender, RoutedEventArgs e)
    {
        LoadModelsButton.IsEnabled = false; _readingModels = true;
        try { await Guard(async () =>
        {
            var profile = ReadProfile(forModelList: true);
            var revision = _modelListRevision;
            ApiResultText.Text = "正在读取服务提供的模型…";
            var reply = await _bridge.SendAsync("api_models", profile);
            if (revision != _modelListRevision) return;
            var models = reply.GetProperty("models").EnumerateArray().Select(m => m.GetString()).OfType<string>().Distinct().ToList();
            ModelsCombo.SelectedItem = null;
            ModelsCombo.ItemsSource = models; ModelsCombo.Visibility = models.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
            ModelsCombo.SelectedItem = models.FirstOrDefault(m => m == ModelBox.Text.Trim());
            ApiResultText.Text = $"读取到 {models.Count} 个模型。也可手动填写。";
            await CaptureApiLayoutAsync();
        }); }
        finally { _readingModels = false; LoadModelsButton.IsEnabled = _bridgeReady; }
    }
    private void ModelsCombo_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (ModelsCombo.SelectedItem is string model) ModelBox.Text = model;
    }
    private void ModelBox_TextChanged(object sender, TextChangedEventArgs e)
    {
        if (ModelsCombo?.SelectedItem is string model && model != ModelBox.Text.Trim()) ModelsCombo.SelectedItem = null;
    }
    private async void ConnectButton_Click(object sender, RoutedEventArgs e) => await Guard(async () =>
    {
        var connection = new ConnectionSettings { Host = HostBox.Text.Trim(), Port = ReadInteger(PortBox, 1, 65535, "端口"), Auth = Tag(AuthCombo), Username = UsernameBox.Text.Trim(), Version = VersionBox.Text.Trim(), WorldId = MapWorldIdBox.Text.Trim() };
        _settings.Connection = connection; Persist(); _connecting = true; UpdateButtons();
        try { await SyncGameChatAsync(); await _bridge.SendAsync("connect", connection); }
        catch { _connecting = false; UpdateButtons(); throw; }
    });
    private async void DisconnectButton_Click(object sender, RoutedEventArgs e) => await Guard(async () => { await _bridge.SendAsync("disconnect", new { }); });
    private async void StartButton_Click(object sender, RoutedEventArgs e) => await Guard(async () =>
    {
        if (ActiveProfileCombo.SelectedItem is not ApiProfile profile) throw new InvalidOperationException("请先添加并选择模型 API。");
        _settings.LastGoal = GoalBox.Text; Persist(); _agentRunning = true; UpdateButtons();
        try { await _bridge.SendAsync("agent_start", new { goal = GoalBox.Text, profile, preferences = _settings.Preferences }); }
        catch { _agentRunning = false; UpdateButtons(); throw; }
    });
    private async void StopButton_Click(object sender, RoutedEventArgs e) => await Guard(async () => { await _bridge.SendAsync("agent_stop", new { }); });
    private async void RefreshButton_Click(object sender, RoutedEventArgs e) => await Guard(async () => { RenderObservation(await _bridge.SendAsync("observe", new { })); });
    private async void EatButton_Click(object sender, RoutedEventArgs e) => await Guard(async () => { await _bridge.SendAsync("action", new { action = "eat", args = new { } }); });
    private void ClearLogs_Click(object sender, RoutedEventArgs e) => _logs.Clear();
    private async void OpenLogs_Click(object sender, RoutedEventArgs e) => await Guard(async () =>
    {
        System.IO.Directory.CreateDirectory(_logStore.DirectoryPath);
        if (!await Windows.System.Launcher.LaunchFolderPathAsync(_logStore.DirectoryPath))
            throw new InvalidOperationException("无法打开日志目录：" + _logStore.DirectoryPath);
    });
    private async void SaveSettings_Click(object sender, RoutedEventArgs e) => await Guard(async () =>
    {
        var interval = IntervalBox.Value;
        if (!double.IsFinite(interval) || interval < 0.5 || interval > 30) throw new InvalidOperationException("每步间隔需在 0.5–30 秒之间。");
        var chatInterval = ChatIntervalBox.Value;
        if (!double.IsFinite(chatInterval) || chatInterval < 3 || chatInterval > 120) throw new InvalidOperationException("发言间隔需在 3–120 秒之间。");
        _settings.Preferences = new AgentPreferences { MaxSteps = ReadInteger(MaxStepsBox, 1, 1000, "最大步数"), BatchSize = ReadInteger(BatchSizeBox, 1, 8, "每批动作数"), IntervalSeconds = interval, StopHealth = ReadInteger(StopHealthBox, 0, 19, "停止生命值"), AutoEat = AutoEatSwitch.IsOn,
            ChatEnabled = ChatEnabledSwitch.IsOn, AutoReplyChat = AutoReplyChatSwitch.IsOn, ChatIntervalSeconds = chatInterval, ChatPrompt = ChatPromptBox.Text.Trim(), CustomPrompt = CustomPromptBox.Text.Trim() };
        _settings.Theme = Tag(ThemeCombo); ApplyTheme(); Persist(); UpdateButtons();
        if (_bridgeReady) await SyncGameChatAsync();
        ShowNotice("运行设置已保存。游戏聊天设置已更新，新游玩提示词用于下次任务。", InfoBarSeverity.Success);
    });
    private void ApplyTheme() => Root.RequestedTheme = _settings.Theme switch { "Dark" => ElementTheme.Dark, "Light" => ElementTheme.Light, _ => ElementTheme.Default };
    private void UpdateButtons()
    {
        if (StartButton is null || ActiveProfileCombo is null) return;
        StartButton.IsEnabled = _bridgeReady && _connected && !_agentRunning && ActiveProfileCombo.SelectedItem is ApiProfile;
        StopButton.IsEnabled = _bridgeReady && _agentRunning;
        GenerateChatButton.IsEnabled = _bridgeReady && _connected && !_chatGenerating && _settings.Preferences.ChatEnabled && ActiveProfileCombo.SelectedItem is ApiProfile;
        CancelChatButton.IsEnabled = _bridgeReady && _chatGenerating;
        ChatTopicBox.IsEnabled = !_chatGenerating;
        GoalBox.IsEnabled = !_agentRunning; ActiveProfileCombo.IsEnabled = !_agentRunning;
        ConnectButton.IsEnabled = _bridgeReady && !_connected && !_connecting;
        DisconnectButton.IsEnabled = _bridgeReady && (_connected || _connecting);
        TestApiButton.IsEnabled = _bridgeReady; LoadModelsButton.IsEnabled = _bridgeReady;
        AgentProgress.IsActive = _agentRunning; AgentProgress.Visibility = _agentRunning ? Visibility.Visible : Visibility.Collapsed;
        MapDimensionCombo.IsEnabled = !_connected && !_connecting; MapWorldIdBox.IsEnabled = !_connected && !_connecting; OpenMapCacheButton.IsEnabled = _bridgeReady && !_connected && !_connecting;
    }
    private void HandleEvent(string name, JsonElement data)
    {
        try
        {
            switch (name)
            {
                case "log": AddLog(data.GetProperty("level").GetString()!, data.GetProperty("message").GetString()!); break;
                case "map_status": RenderMapStatus(data); break;
                case "map_error": AddLog("error", data.GetProperty("message").GetString()!); break;
                case "map_import":
                    ImportMapStatusText.Text = data.GetProperty("message").GetString();
                    ShowNotice(ImportMapStatusText.Text ?? "导入结束", data.GetProperty("state").GetString() == "error" ? InfoBarSeverity.Error : InfoBarSeverity.Success);
                    _ = RefreshMapQuietly(); break;
                case "auth": AuthNotice.Message = $"在微软页面输入代码 {data.GetProperty("code").GetString()}，完成后程序会继续连接。"; AuthNotice.IsOpen = true; NavigateTo("connection"); break;
                case "connection":
                    var state = data.GetProperty("state").GetString();
                    _connected = state == "connected"; _connecting = state == "connecting";
                    ConnectionStateText.Text = _connected ? "世界已连接" : _connecting ? "正在连接…" : "未连接世界";
                    ConnectionDot.Fill = new SolidColorBrush(_connected ? Color.FromArgb(255, 53, 184, 154) : _connecting ? Color.FromArgb(255, 221, 177, 111) : Color.FromArgb(255, 140, 140, 140));
                    ConnectionDetailText.Text = data.GetProperty("message").GetString();
                    if (!_connecting) AuthNotice.IsOpen = false;
                    if (!_connected && !_connecting) { _inventory.Clear(); InventoryList.Visibility = Visibility.Collapsed; InventoryEmptyText.Visibility = Visibility.Visible; InventoryEmptyText.Text = "连接世界后，这里会显示真实背包。"; HealthText.Text = "— / 20"; FoodText.Text = "— / 20"; HealthBar.Value = 0; FoodBar.Value = 0; DimensionText.Text = "等待进入"; PositionText.Text = "—, —, —"; TimeText.Text = "读取世界时间"; HeldItemText.Text = "手持：—"; InventoryCountText.Text = "0 个物品栏"; ResetMap(); }
                    AddLog("info", ConnectionDetailText.Text ?? "连接状态改变"); UpdateButtons(); break;
                case "observation": RenderObservation(data); break;
                case "chat":
                    var chatState = data.GetProperty("state").GetString();
                    if (chatState == "sent")
                    {
                        LastChatText.Text = "最近发言：" + Redact(data.GetProperty("message").GetString() ?? ""); LastChatText.Visibility = Visibility.Visible;
                        ChatStatusText.Text = "已发送到游戏聊天栏。";
                    }
                    else if (chatState != "received" && data.TryGetProperty("source", out var source)) ChatStatusText.Text = Redact(data.GetProperty("message").GetString() ?? "");
                    break;
                case "agent":
                    var agentState = data.GetProperty("state").GetString();
                    if (data.TryGetProperty("goal", out var gameGoal)) GoalBox.Text = gameGoal.GetString() ?? "";
                    _agentRunning = agentState is "running" or "thinking" or "acting" or "stopping" or "recovering";
                    AgentStateText.Text = Redact(data.GetProperty("message").GetString() ?? "");
                    UsageText.Text = $"{data.GetProperty("step").GetInt32()} 步 · {data.GetProperty("tokens").GetInt32():N0} tokens";
                    if (agentState == "completed") ShowNotice(AgentStateText.Text, InfoBarSeverity.Success);
                    if (agentState == "error") ShowNotice(AgentStateText.Text, InfoBarSeverity.Error);
                    UpdateButtons(); break;
                case "decision": DecisionText.Text = $"第 {data.GetProperty("step").GetInt32()} 步 · {data.GetProperty("action").GetString()} · {Redact(data.GetProperty("reason").GetString() ?? "")}"; break;
            }
        }
        catch (Exception error) { AddLog("error", "数据更新失败：" + error.Message); }
    }
    private void RenderObservation(JsonElement data)
    {
        _lastObservation = data;
        var player = data.GetProperty("player");
        var p = player.GetProperty("position");
        var health = player.GetProperty("health").GetDouble(); var food = player.GetProperty("food").GetDouble();
        HealthText.Text = $"{health:0.#} / 20"; FoodText.Text = $"{food:0.#} / 20";
        HealthBar.Value = health; FoodBar.Value = food;
        PositionText.Text = $"{p.GetProperty("x").GetDouble():0.#}, {p.GetProperty("y").GetDouble():0.#}, {p.GetProperty("z").GetDouble():0.#}";
        var dim = player.GetProperty("dimension").ToString();
        DimensionText.Text = dim.Contains("nether") ? "下界" : dim.Contains("end") ? "末地" : "主世界";
        var time = data.GetProperty("time");
        TimeText.Text = time.TryGetProperty("isDay", out var day) && day.ValueKind == JsonValueKind.True ? "白天" : "夜晚";
        var held = player.GetProperty("heldItem");
        HeldItemText.Text = held.ValueKind == JsonValueKind.Null ? "手持：空" : "手持：" + held.GetProperty("displayName").GetString();
        _inventory.Clear();
        foreach (var i in data.GetProperty("inventory").EnumerateArray()) _inventory.Add(new InventoryRow(i.GetProperty("name").GetString()!, i.GetProperty("displayName").GetString()!, i.GetProperty("count").GetInt32(), i.GetProperty("slot").GetInt32(), ItemIconService.Item(i.GetProperty("name").GetString()!)));
        InventoryCountText.Text = $"{_inventory.Count} 个物品栏";
        InventoryList.Visibility = _inventory.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
        InventoryEmptyText.Visibility = _inventory.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
        InventoryEmptyText.Text = "背包暂时是空的，开始采集吧。";
        RenderMap(data.GetProperty("localMap"));
    }
    private void InitializeMap()
    {
        for (int z = 0; z < 21; z++) for (int x = 0; x < 21; x++)
        {
            var tile = new Rectangle { Width = 13, Height = 13, RadiusX = 1, RadiusY = 1, Fill = MapBrush("unloaded", false) };
            Canvas.SetLeft(tile, x * 14); Canvas.SetTop(tile, z * 14); MapCanvas.Children.Add(tile); _tiles.Add(tile);
        }
        var marker = new Ellipse { Width = 10, Height = 10, Fill = new SolidColorBrush(Color.FromArgb(255, 53, 184, 154)), Stroke = new SolidColorBrush(Colors.White), StrokeThickness = 2, IsHitTestVisible = false };
        Canvas.SetLeft(marker, 142); Canvas.SetTop(marker, 142); MapCanvas.Children.Add(marker);
        marker.Visibility = Visibility.Collapsed;
    }
    private void ResetMap()
    {
        foreach (var tile in _tiles) { tile.Fill = MapBrush("unloaded", false); ToolTipService.SetToolTip(tile, null); }
        if (MapCanvas.Children.LastOrDefault() is Ellipse marker) marker.Visibility = Visibility.Collapsed;
    }
    private void RenderMap(JsonElement map)
    {
        int index = 0;
        foreach (var cell in map.GetProperty("cells").EnumerateArray())
        {
            if (index >= _tiles.Count) break;
            var tile = _tiles[index++]; var name = cell.GetProperty("name").GetString()!;
            tile.Fill = MapBrush(name, cell.GetProperty("hazardous").GetBoolean());
            ToolTipService.SetToolTip(tile, $"{name}\nX {cell.GetProperty("x")} · Y {cell.GetProperty("y")} · Z {cell.GetProperty("z")}");
            Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(tile, name);
        }
        if (MapCanvas.Children.LastOrDefault() is Ellipse marker) marker.Visibility = Visibility.Visible;
    }
    private SolidColorBrush MapBrush(string name, bool hazard)
    {
        var color = hazard ? "EFA16A" : name switch
        {
            "unloaded" => "1A312C", "obstacle" => "2D423E", "grass_block" or "moss_block" => "6DAD71", "water" => "78B7DC",
            "sand" or "sandstone" => "CBB986", "dirt" or "coarse_dirt" or "farmland" => "8D765C",
            "snow" or "snow_block" or "ice" => "C1D9DE", "stone" or "cobblestone" or "deepslate" => "788985",
            _ when name.Contains("log") || name.Contains("planks") => "A28C61",
            _ when name.Contains("leaves") => "517E57", _ when name.Contains("ore") => "A5BBC2",
            _ => "667E73"
        };
        if (!_mapBrushes.TryGetValue(color, out var brush))
        {
            brush = new SolidColorBrush(Color.FromArgb(255, Convert.ToByte(color[..2], 16), Convert.ToByte(color[2..4], 16), Convert.ToByte(color[4..6], 16)));
            _mapBrushes[color] = brush;
        }
        return brush;
    }
}
