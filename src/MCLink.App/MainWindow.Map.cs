using System.Text.Json;
using MCLink.App.Services;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Windows.Storage.Pickers;
using WinRT.Interop;

namespace MCLink.App;
public sealed partial class MainWindow
{
    private bool _mapReady, _mapRefreshing, _mapRefreshRequested, _syncMapDimension;
    private int _mapToolbarMode = -1;
    private bool _mapToolsOpen;
    private double _mapCenterX, _mapCenterZ;
    private int _mapSize = 256;
    private JsonElement? _mapPosition, _lastObservation;
    private readonly DispatcherTimer _mapTimer = new() { Interval = TimeSpan.FromSeconds(3) };

    private async Task InitializeMapFeaturesAsync()
    {
        UpdateWorldMapLayout();
        ItemIconService.Configure(_settings.IconDirectory); ApplyUiIcons();
        CustomIconPathText.Text = string.IsNullOrEmpty(_settings.IconDirectory) ? "正在使用随程序附带的 SVG 图标。" : _settings.IconDirectory;
        MapWorldIdBox.Text = _settings.Connection.WorldId;
        ImportVersionBox.Text = _settings.ImportVersion;
        _mapSize = new[] { 64, 128, 256, 512 }.Contains(_settings.MapSize) ? _settings.MapSize : 256;
        SelectTag(MapRangeCombo, _mapSize.ToString());
        WorldMapView.HoverChanged += text => MapHoverText.Text = text;
        WorldMapView.PanRequested += async (x, z) => { FollowMapSwitch.IsOn = false; _mapCenterX += x; _mapCenterZ += z; await Guard(RefreshMapAsync); };
        WorldMapView.ZoomRequested += delta => { MapRangeCombo.SelectedIndex = Math.Clamp(MapRangeCombo.SelectedIndex + delta, 0, MapRangeCombo.Items.Count - 1); };
        await ConfigureMapAsync();
        _mapReady = true;
        _mapTimer.Tick += async (_, _) => { if (WorldMapPanel.Visibility == Visibility.Visible) await RefreshMapQuietly(); };
        _mapTimer.Start(); Closed += (_, _) => _mapTimer.Stop();
    }
    private void ApplyUiIcons()
    {
        var names = new Dictionary<string, string> { ["dashboard"] = "dashboard", ["map"] = "world_map", ["api"] = "model", ["connection"] = "connection", ["settings"] = "settings", ["help"] = "help" };
        foreach (var item in Navigation.MenuItems.Concat(Navigation.FooterMenuItems).OfType<NavigationViewItem>())
            if (item.Tag is string tag && names.TryGetValue(tag, out var name)) item.Icon = new ImageIcon { Source = ItemIconService.UI(name) };
        HealthIcon.Source = ItemIconService.UI("health"); FoodIcon.Source = ItemIconService.UI("food");
        DimensionIcon.Source = ItemIconService.UI("dimension"); PositionIcon.Source = ItemIconService.UI("player");
        BrandIcon.Source = ItemIconService.Item("diamond_pickaxe");
        InventoryHeadingIcon.Source = ItemIconService.UI("inventory");
    }
    private async Task ConfigureMapAsync()
    {
        var connection = _settings.Connection;
        var result = await _bridge.SendAsync("map_configure", new { host = connection.Host, port = connection.Port, worldId = MapWorldIdBox.Text.Trim(), dimension = Tag(MapDimensionCombo) });
        RenderMapStatus(result);
    }
    private async Task RefreshMapAsync()
    {
        if (!_mapReady) return;
        if (_mapRefreshing) { _mapRefreshRequested = true; return; }
        _mapRefreshing = true;
        try
        {
            do
            {
            _mapRefreshRequested = false;
            if (FollowMapSwitch.IsOn && _mapPosition is { } p) { _mapCenterX = p.GetProperty("x").GetDouble(); _mapCenterZ = p.GetProperty("z").GetDouble(); }
            var map = await _bridge.SendAsync("map_view", new { centerX = _mapCenterX, centerZ = _mapCenterZ, size = _mapSize, resolution = Math.Min(128, _mapSize) });
            WorldMapView.Render(map); RenderMapStatus(map);
            await CaptureMapLayoutAsync();
            } while (_mapRefreshRequested);
        }
        finally { _mapRefreshing = false; }
    }
    private async Task RefreshMapQuietly()
    {
        try { await RefreshMapAsync(); }
        catch (Exception error) { MapPerformanceText.Text = error.Message; }
    }
    private void RenderMapStatus(JsonElement data)
    {
        MapStatsText.Text = $"缓存：{data.GetProperty("chunks").GetInt32():N0} 个区块";
        MapPerformanceText.Text = $"本次扫描 {data.GetProperty("scanMs").GetDouble():0.##} ms · 待处理 {data.GetProperty("pending").GetInt32()}";
        if (data.TryGetProperty("dimension", out var dimension))
        {
            _syncMapDimension = true;
            try { SelectTag(MapDimensionCombo, dimension.GetString()!); }
            finally { _syncMapDimension = false; }
        }
        if (data.TryGetProperty("position", out var position) && position.ValueKind == JsonValueKind.Object)
        {
            _mapPosition = position;
            WorldPositionText.Text = (_connected ? "" : "上次记录的位置\n") + $"X {position.GetProperty("x").GetDouble():0.#}\nY {position.GetProperty("y").GetDouble():0.#}\nZ {position.GetProperty("z").GetDouble():0.#}";
            MapPositionSummaryText.Text = (_connected ? "AI" : "上次位置") + $" · X {position.GetProperty("x").GetDouble():0.#}  Y {position.GetProperty("y").GetDouble():0.#}  Z {position.GetProperty("z").GetDouble():0.#}";
            if (WorldMapPanel.Visibility == Visibility.Visible) WorldMapView.UpdatePosition(position);
        }
        else { _mapPosition = null; WorldPositionText.Text = "等待连接"; MapPositionSummaryText.Text = "连接世界或导入存档，查看已生成地形。"; }
        if (data.TryGetProperty("import", out var import) && import.ValueKind == JsonValueKind.Object)
        {
            StopImportButton.IsEnabled = import.GetProperty("state").GetString() == "running";
            StartImportButton.IsEnabled = !StopImportButton.IsEnabled;
            if (import.TryGetProperty("message", out var message)) ImportMapStatusText.Text = message.GetString();
            if (import.TryGetProperty("lastError", out var lastError)) ImportMapStatusText.Text += "\n" + lastError.GetString();
            if (import.TryGetProperty("seed", out var seed) && seed.ValueKind == JsonValueKind.String) MapSeedText.Text = "存档种子：" + seed.GetString();
        }
    }
    private async void MapRangeCombo_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (!_mapReady) return;
        if (int.TryParse(Tag(MapRangeCombo), out var size)) { _mapSize = size; _settings.MapSize = size; await Guard(RefreshMapAsync); }
    }
    private async void MapDimensionCombo_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (!_mapReady || _syncMapDimension || _connected || _connecting) return;
        await Guard(async () => { await ConfigureMapAsync(); _mapCenterX = 0; _mapCenterZ = 0; await RefreshMapAsync(); });
    }
    private async void RefreshWorldMap_Click(object sender, RoutedEventArgs e) => await Guard(RefreshMapAsync);
    private async void FollowMapSwitch_Toggled(object sender, RoutedEventArgs e)
    {
        if (_mapReady && FollowMapSwitch.IsOn) await Guard(RefreshMapAsync);
    }
    private void WorldMapPanel_SizeChanged(object sender, SizeChangedEventArgs e) => UpdateWorldMapLayout();
    private void UpdateWorldMapLayout()
    {
        if (MapToolbar is null || MapInspectorHost is null || MapToolsButton is null) return;
        var width = WorldMapPanel.ActualWidth;
        var showInspector = width >= 820;
        if (showInspector) _mapToolsOpen = false;
        var showToolsPage = !showInspector && _mapToolsOpen;
        MapInspectorColumn.Width = new GridLength(showInspector ? 300 : 0);
        MapInspectorGapColumn.Width = new GridLength(showInspector ? 16 : 0);
        Grid.SetColumn(MapInspectorHost, showInspector ? 2 : 0);
        MapInspectorHost.Visibility = showInspector || showToolsPage ? Visibility.Visible : Visibility.Collapsed;
        MapFrame.Visibility = showToolsPage ? Visibility.Collapsed : Visibility.Visible;
        MapToolbarCard.Visibility = showToolsPage ? Visibility.Collapsed : Visibility.Visible;
        MapPageTitle.Text = showToolsPage ? "地图工具" : "世界地图";
        MapToolsButton.Content = showToolsPage ? "返回地图" : "地图工具";
        MapToolsButton.Visibility = showInspector ? Visibility.Collapsed : Visibility.Visible;
        var mode = width >= 680 ? 0 : width >= 440 ? 1 : 2;
        if (_mapToolbarMode == mode) return;
        _mapToolbarMode = mode;
        MapToolbar.RowDefinitions.Clear();
        for (var i = 0; i < (mode == 0 ? 1 : mode == 1 ? 2 : 4); i++) MapToolbar.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        MapToolbar.RowSpacing = mode == 0 ? 0 : 8;
        MapDimensionCombo.Header = mode == 0 ? "维度" : null;
        MapRangeCombo.Header = mode == 0 ? "显示范围" : null;
        FollowMapSwitch.Header = mode == 0 ? "跟随 AI" : null;
        FollowMapSwitch.OnContent = mode == 0 ? "开启" : "跟随 AI";
        FollowMapSwitch.OffContent = mode == 0 ? "关闭" : "自由查看";
        ToolTipService.SetToolTip(MapDimensionCombo, "地图维度");
        ToolTipService.SetToolTip(MapRangeCombo, "显示范围");
        MapToolbarFirstColumn.Width = mode == 0 ? new GridLength(170) : new GridLength(1, GridUnitType.Star);
        MapToolbarSecondColumn.Width = mode == 0 ? new GridLength(180) : mode == 1 ? new GridLength(1, GridUnitType.Star) : new GridLength(0);
        MapToolbarThirdColumn.Width = mode == 0 ? new GridLength(1, GridUnitType.Star) : new GridLength(0);
        MapToolbarFourthColumn.Width = mode == 0 ? GridLength.Auto : new GridLength(0);
        SetMapToolbarCell(MapDimensionCombo, 0, 0);
        SetMapToolbarCell(MapRangeCombo, mode == 2 ? 1 : 0, mode == 2 ? 0 : 1);
        SetMapToolbarCell(FollowMapSwitch, mode == 0 ? 0 : mode == 1 ? 1 : 2, mode == 0 ? 2 : 0);
        SetMapToolbarCell(RefreshWorldMapButton, mode == 0 ? 0 : mode == 1 ? 1 : 3, mode == 0 ? 3 : mode == 1 ? 1 : 0);
        RefreshWorldMapButton.HorizontalAlignment = mode == 0 ? HorizontalAlignment.Right : HorizontalAlignment.Stretch;
    }
    private static void SetMapToolbarCell(FrameworkElement element, int row, int column)
    {
        Grid.SetRow(element, row); Grid.SetColumn(element, column);
    }
    private void MapToolsButton_Click(object sender, RoutedEventArgs e)
    {
        MapToolsButton.Focus(FocusState.Programmatic);
        _mapToolsOpen = !_mapToolsOpen;
        UpdateWorldMapLayout();
    }
    private async void JumpMap_Click(object sender, RoutedEventArgs e) => await Guard(async () =>
    {
        if (!double.IsFinite(MapCenterXBox.Value) || !double.IsFinite(MapCenterZBox.Value)) throw new InvalidOperationException("请填写有效的 X、Z 坐标。");
        FollowMapSwitch.IsOn = false; _mapCenterX = MapCenterXBox.Value; _mapCenterZ = MapCenterZBox.Value;
        await RefreshMapAsync();
    });
    private async void OpenMapCache_Click(object sender, RoutedEventArgs e) => await Guard(async () =>
    {
        _settings.Connection.WorldId = MapWorldIdBox.Text.Trim(); _settings.MapWorldId = MapWorldIdBox.Text.Trim(); Persist();
        await ConfigureMapAsync(); await RefreshMapAsync();
    });
    private async Task<string?> PickFolderAsync()
    {
        var picker = new FolderPicker { SuggestedStartLocation = PickerLocationId.DocumentsLibrary };
        picker.FileTypeFilter.Add("*"); InitializeWithWindow.Initialize(picker, WindowNative.GetWindowHandle(this));
        return (await picker.PickSingleFolderAsync())?.Path;
    }
    private async void ImportWorldButton_Click(object sender, RoutedEventArgs e) => await Guard(async () =>
    {
        var folder = await PickFolderAsync(); if (folder is not null) MapImportPathBox.Text = folder;
    });
    private async void StartImportButton_Click(object sender, RoutedEventArgs e) => await Guard(async () =>
    {
        if (string.IsNullOrWhiteSpace(MapImportPathBox.Text)) throw new InvalidOperationException("请选择或填写存档目录。");
        _settings.ImportVersion = ImportVersionBox.Text.Trim(); Persist();
        await _bridge.SendAsync("map_import", new { path = MapImportPathBox.Text.Trim(), version = ImportVersionBox.Text.Trim(), dimension = Tag(MapDimensionCombo), centerX = _mapCenterX, centerZ = _mapCenterZ, radius = ReadInteger(ImportRadiusBox, 32, 1024, "导入半径") });
        StopImportButton.IsEnabled = true; StartImportButton.IsEnabled = false; ImportMapStatusText.Text = "正在读取已生成的区块…";
    });
    private async void StopImportButton_Click(object sender, RoutedEventArgs e) => await Guard(async () => { await _bridge.SendAsync("map_import_stop", new { }); StopImportButton.IsEnabled = false; StartImportButton.IsEnabled = true; });
    private async void ImportIconsButton_Click(object sender, RoutedEventArgs e) => await Guard(async () =>
    {
        var folder = await PickFolderAsync(); if (folder is null) return;
        var directories = new[] { folder, Path.Combine(folder, "ItemIcons"), Path.Combine(folder, "UI") };
        if (!directories.Where(Directory.Exists).SelectMany(d => Directory.EnumerateFiles(d)).Any(f => new[] { ".svg", ".png", ".jpg" }.Contains(Path.GetExtension(f).ToLowerInvariant()))) throw new InvalidOperationException("目录中没有 SVG、PNG 或 JPG 图标。");
        _settings.IconDirectory = folder; Persist(); ItemIconService.Configure(folder); ApplyUiIcons();
        CustomIconPathText.Text = folder; if (_lastObservation is { } data) RenderObservation(data);
        ShowNotice("自定义图标目录已启用。物品文件名应与注册名一致，例如 apple.svg。", InfoBarSeverity.Success);
    });
    private async void ResetIconsButton_Click(object sender, RoutedEventArgs e) => await Guard(() =>
    {
        _settings.IconDirectory = ""; Persist(); ItemIconService.Configure(""); ApplyUiIcons();
        CustomIconPathText.Text = "正在使用随程序附带的 SVG 图标。";
        if (_lastObservation is { } data) RenderObservation(data);
        return Task.CompletedTask;
    });
}
