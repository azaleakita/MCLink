using System.Runtime.InteropServices.WindowsRuntime;
using System.Text.Json;
using MCLink.App.Services;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using Microsoft.UI.Xaml.Shapes;
using Windows.Foundation;
using Windows.UI;

namespace MCLink.App.Controls;
public sealed partial class WorldMapControl : UserControl
{
    public event Action<double, double>? PanRequested;
    public event Action<int>? ZoomRequested;
    public event Action<string>? HoverChanged;
    private JsonElement _map;
    private bool _hasMap, _dragging;
    private Point _pressed;
    private byte[] _heights = [], _ids = [];
    private string[] _legend = [];
    private int _resolution;
    public WorldMapControl() { InitializeComponent(); }
    private void Viewport_SizeChanged(object sender, SizeChangedEventArgs e)
    {
        ViewportClip.Rect = new Rect(0, 0, Math.Max(0, e.NewSize.Width), Math.Max(0, e.NewSize.Height));
    }
    public void Render(JsonElement map)
    {
        _map = map; _hasMap = true;
        _resolution = map.GetProperty("width").GetInt32();
        var bitmap = new WriteableBitmap(_resolution, _resolution);
        using (var stream = bitmap.PixelBuffer.AsStream()) { var bytes = Convert.FromBase64String(map.GetProperty("pixels").GetString()!); stream.Write(bytes); }
        bitmap.Invalidate(); TerrainImage.Source = bitmap;
        _heights = Convert.FromBase64String(map.GetProperty("heights").GetString()!);
        _ids = Convert.FromBase64String(map.GetProperty("blockIds").GetString()!);
        _legend = map.GetProperty("legend").EnumerateArray().Select(v => v.GetString()!).ToArray();
        EmptyMessage.Visibility = map.GetProperty("chunks").GetInt32() == 0 ? Visibility.Visible : Visibility.Collapsed;
        ScaleText.Text = $"{map.GetProperty("size").GetInt32()} × {map.GetProperty("size").GetInt32()} 格";
        RenderOverlay();
    }
    public void UpdatePosition(JsonElement? position, IReadOnlyList<Point>? trail = null)
    {
        if (!_hasMap) return;
        RenderOverlay(position, trail);
    }
    private Point ToScreen(double x, double z)
    {
        var size = _map.GetProperty("size").GetInt32();
        return new Point((x - _map.GetProperty("startX").GetDouble()) * 512 / size, (z - _map.GetProperty("startZ").GetDouble()) * 512 / size);
    }
    private void RenderOverlay(JsonElement? newPosition = null, IReadOnlyList<Point>? newTrail = null)
    {
        Overlay.Children.Clear();
        var points = newTrail ?? _map.GetProperty("trail").EnumerateArray().Select(p => new Point(p.GetProperty("x").GetDouble(), p.GetProperty("z").GetDouble())).ToList();
        var line = new Polyline { Stroke = new SolidColorBrush(Color.FromArgb(210, 67, 212, 174)), StrokeThickness = 2, StrokeLineJoin = PenLineJoin.Round };
        foreach (var point in points) line.Points.Add(ToScreen(point.X, point.Y));
        Overlay.Children.Add(line);
        var position = newPosition ?? (_map.TryGetProperty("position", out var p0) && p0.ValueKind == JsonValueKind.Object ? p0 : (JsonElement?)null);
        if (position is not { } p || p.ValueKind != JsonValueKind.Object) return;
        var location = ToScreen(p.GetProperty("x").GetDouble(), p.GetProperty("z").GetDouble());
        var marker = new Border { Width = 26, Height = 26, CornerRadius = new CornerRadius(13), BorderBrush = new SolidColorBrush(Color.FromArgb(255, 232, 255, 241)), BorderThickness = new Thickness(2), Background = new SolidColorBrush(Color.FromArgb(255, 53, 184, 154)), Child = new Image { Source = ItemIconService.UI("player"), Width = 18, Height = 18 } };
        Canvas.SetLeft(marker, location.X - 13); Canvas.SetTop(marker, location.Y - 13); Overlay.Children.Add(marker);
    }
    private void MapPlane_PointerPressed(object sender, PointerRoutedEventArgs e)
    {
        if (e.GetCurrentPoint(MapPlane).Properties.IsLeftButtonPressed) { _pressed = e.GetCurrentPoint(MapPlane).Position; _dragging = true; MapPlane.CapturePointer(e.Pointer); e.Handled = true; }
    }
    private void MapPlane_PointerMoved(object sender, PointerRoutedEventArgs e)
    {
        if (!_hasMap) return;
        var point = e.GetCurrentPoint(MapPlane).Position;
        var x = Math.Clamp((int)(point.X / 512 * _resolution), 0, _resolution - 1);
        var z = Math.Clamp((int)(point.Y / 512 * _resolution), 0, _resolution - 1);
        var index = (z * _resolution + x) * 2;
        var id = BitConverter.ToUInt16(_ids, index); var height = BitConverter.ToInt16(_heights, index);
        var wx = _map.GetProperty("startX").GetDouble() + point.X / 512 * _map.GetProperty("size").GetInt32();
        var wz = _map.GetProperty("startZ").GetDouble() + point.Y / 512 * _map.GetProperty("size").GetInt32();
        HoverChanged?.Invoke($"X {Math.Floor(wx)} · Z {Math.Floor(wz)} · {(height == short.MinValue ? "未知区域" : $"地面 Y {height} · {_legend[id]}")}");
    }
    private void MapPlane_PointerReleased(object sender, PointerRoutedEventArgs e)
    {
        if (!_dragging) return;
        _dragging = false; MapPlane.ReleasePointerCapture(e.Pointer);
        if (_hasMap) { var point = e.GetCurrentPoint(MapPlane).Position; var scale = _map.GetProperty("size").GetInt32() / 512.0; PanRequested?.Invoke((_pressed.X - point.X) * scale, (_pressed.Y - point.Y) * scale); }
        e.Handled = true;
    }
    private void MapPlane_PointerCaptureLost(object sender, PointerRoutedEventArgs e) => _dragging = false;
    private void MapPlane_PointerWheelChanged(object sender, PointerRoutedEventArgs e) { ZoomRequested?.Invoke(e.GetCurrentPoint(MapPlane).Properties.MouseWheelDelta > 0 ? -1 : 1); e.Handled = true; }
}
