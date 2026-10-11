using Microsoft.UI.Xaml;

namespace MCLink.App;
public partial class App : Application
{
    private Window? _window;
    public App()
    {
        InitializeComponent();
        UnhandledException += (_, args) =>
        {
            if (Environment.GetEnvironmentVariable("MCLINK_DIAGNOSTICS") != "1") return;
            try
            {
                Directory.CreateDirectory(Services.SettingsStore.DataDirectory);
                File.WriteAllText(Path.Combine(Services.SettingsStore.DataDirectory, "crash.txt"), args.Exception.ToString());
            }
            catch { /* Diagnostics must not hide the original failure. */ }
        };
    }
    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        _window = new MainWindow();
        _window.Activate();
    }
}
