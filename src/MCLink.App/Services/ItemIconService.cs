using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;

namespace MCLink.App.Services;
public static class ItemIconService
{
    private static readonly Dictionary<string, ImageSource> Images = [];
    private static string? _customDirectory;
    public static void Configure(string directory)
    {
        _customDirectory = string.IsNullOrWhiteSpace(directory) ? null : directory;
        Images.Clear();
    }
    public static ImageSource? Item(string name) => Find("ItemIcons", name);
    public static ImageSource? UI(string name) => Find("UI", name);
    private static ImageSource? Find(string type, string name)
    {
        name = name.Replace("minecraft:", "");
        if (!System.Text.RegularExpressions.Regex.IsMatch(name, "^[a-z0-9_]+$")) return null;
        var key = type + "/" + name;
        if (Images.TryGetValue(key, out var cached)) return cached;
        var directories = new List<string>();
        if (_customDirectory is not null) { directories.Add(Path.Combine(_customDirectory, type)); directories.Add(_customDirectory); }
        directories.Add(Path.Combine(AppContext.BaseDirectory, "Assets", type));
        foreach (var folder in directories) foreach (var extension in new[] { ".svg", ".png", ".jpg" })
        {
            var file = Path.Combine(folder, name + extension);
            if (!File.Exists(file)) continue;
            var uri = new Uri(file);
            ImageSource image = extension == ".svg"
                ? new SvgImageSource(uri) { RasterizePixelWidth = 64, RasterizePixelHeight = 64 }
                : new BitmapImage(uri) { DecodePixelWidth = 64, DecodePixelHeight = 64 };
            if (Images.Count > 256) Images.Clear();
            Images[key] = image; return image;
        }
        if (name != "unknown") return Find(type, "unknown");
        return null;
    }
}
