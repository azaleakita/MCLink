using System.Runtime.InteropServices.WindowsRuntime;
using System.Text.Json;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using Windows.Foundation;
using Windows.Graphics.Imaging;
using Windows.Storage;
using Windows.UI;

namespace MCLink.App;
public sealed partial class MainWindow
{
    private bool _capturingLayout;
    private Task CaptureChatLayoutAsync()
    {
        var settings = SettingsPanel.Visibility == Visibility.Visible;
        var panel = settings ? SettingsPanel : DashboardPanel;
        return CaptureLayoutAsync(Environment.GetEnvironmentVariable(settings ? "MCLINK_CHAT_SETTINGS_CAPTURE" : "MCLINK_CHAT_CAPTURE"), panel,
            () => new { card = LayoutBounds(settings ? ChatSettingsCard : ChatDashboardCard, panel), editor = LayoutBounds(settings ? ChatPromptBox : ChatTopicBox, panel), action = LayoutBounds(settings ? SaveChatSettingsButton : GenerateChatButton, panel), viewport = new { width = panel.ActualWidth, height = panel.ActualHeight } });
    }
    // Opt-in local diagnostics capture only our XAML tree, never the desktop.
    private Task CaptureMapLayoutAsync() => CaptureLayoutAsync(
        Environment.GetEnvironmentVariable("MCLINK_LAYOUT_CAPTURE"), WorldMapPanel,
        () => new { map = LayoutBounds(WorldMapView, WorldMapPanel), inspector = LayoutBounds(MapInspectorHost, WorldMapPanel), toolbar = LayoutBounds(MapToolbar, WorldMapPanel), toolsButton = LayoutBounds(MapToolsButton, WorldMapPanel), viewport = new { width = WorldMapPanel.ActualWidth, height = WorldMapPanel.ActualHeight } });

    private Task CaptureApiLayoutAsync() => CaptureLayoutAsync(
        Environment.GetEnvironmentVariable("MCLINK_API_LAYOUT_CAPTURE"), ApiPanel,
        () => new { content = LayoutBounds(ApiContent, ApiPanel), profiles = LayoutBounds(ApiProfilesCard, ApiPanel), editor = LayoutBounds(ApiEditorCard, ApiPanel), preset = LayoutBounds(PresetCombo, ApiPanel), model = LayoutBounds(ModelBox, ApiPanel), readModels = LayoutBounds(LoadModelsButton, ApiPanel), actions = LayoutBounds(ApiActions, ApiPanel), viewport = new { width = ApiPanel.ActualWidth, height = ApiPanel.ActualHeight } });

    private static object LayoutBounds(FrameworkElement element, FrameworkElement root)
    {
        var rectangle = element.TransformToVisual(root).TransformBounds(new Rect(0, 0, element.ActualWidth, element.ActualHeight));
        var visible = true;
        for (DependencyObject? ancestor = element; ancestor is not null; ancestor = VisualTreeHelper.GetParent(ancestor))
        {
            if (ancestor is UIElement ui && ui.Visibility == Visibility.Collapsed) { visible = false; break; }
            if (ReferenceEquals(ancestor, root)) break;
        }
        return new { x = rectangle.X, y = rectangle.Y, width = rectangle.Width, height = rectangle.Height, visible };
    }

    private async Task CaptureLayoutAsync(string? target, FrameworkElement visual, Func<object> description)
    {
        if (Environment.GetEnvironmentVariable("MCLINK_DIAGNOSTICS") != "1" || string.IsNullOrWhiteSpace(target) || _capturingLayout) return;
        _capturingLayout = true;
        try
        {
            await Task.Delay(100);
            if (visual.Visibility != Visibility.Visible || visual.ActualWidth <= 0 || visual.ActualHeight <= 0) return;
            var image = new RenderTargetBitmap();
            var background = visual is Panel panel ? panel.Background : (visual as Control)?.Background;
            void SetBackground(Brush? brush)
            {
                if (visual is Panel p) p.Background = brush;
                else if (visual is Control control) control.Background = brush;
            }
            try
            {
                SetBackground(new SolidColorBrush(Root.ActualTheme == ElementTheme.Dark ? Color.FromArgb(255, 32, 37, 34) : Color.FromArgb(255, 243, 246, 242)));
                await image.RenderAsync(visual);
            }
            finally { SetBackground(background); }
            var pixels = await image.GetPixelsAsync();
            Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(target))!);
            var folder = await StorageFolder.GetFolderFromPathAsync(Path.GetDirectoryName(Path.GetFullPath(target))!);
            var file = await folder.CreateFileAsync(Path.GetFileName(target), CreationCollisionOption.ReplaceExisting);
            using var stream = await file.OpenAsync(FileAccessMode.ReadWrite);
            stream.Size = 0;
            var encoder = await BitmapEncoder.CreateAsync(BitmapEncoder.PngEncoderId, stream);
            encoder.SetPixelData(BitmapPixelFormat.Bgra8, BitmapAlphaMode.Premultiplied, (uint)image.PixelWidth, (uint)image.PixelHeight, 96, 96, pixels.ToArray());
            await encoder.FlushAsync();
            await File.WriteAllTextAsync(target + ".json", JsonSerializer.Serialize(description()));
        }
        catch (Exception error)
        {
            await File.WriteAllTextAsync(Path.Combine(Services.SettingsStore.DataDirectory, "layout-error.txt"), error.ToString());
        }
        finally { _capturingLayout = false; }
    }
}
