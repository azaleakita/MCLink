using MCLink.App.Models;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace MCLink.App;
public sealed partial class MainWindow
{
    private bool _chatGenerating;
    private bool _chatCancelRequested;
    private string _defaultChatPrompt = "";

    private Task SyncGameChatAsync() => _bridge.SendAsync("game_chat_configure", new
    {
        profile = ActiveProfileCombo.SelectedItem as ApiProfile,
        preferences = _settings.Preferences
    });

    private async Task InitializeChatAsync()
    {
        var defaults = await _bridge.SendAsync("prompt_defaults", new { });
        _defaultChatPrompt = defaults.GetProperty("chatPrompt").GetString() ?? "";
        if (string.IsNullOrWhiteSpace(ChatPromptBox.Text)) ChatPromptBox.Text = _defaultChatPrompt;
        RestoreChatPromptButton.IsEnabled = true;
    }
    private async void GenerateChatButton_Click(object sender, RoutedEventArgs e)
    {
        if (_chatGenerating) return;
        await Guard(async () =>
        {
            if (ActiveProfileCombo.SelectedItem is not ApiProfile profile) throw new InvalidOperationException("请先选择模型 API。");
            if (string.IsNullOrWhiteSpace(ChatTopicBox.Text)) throw new InvalidOperationException("请填写想聊的话题或想说的大意。");
            _chatGenerating = true; _chatCancelRequested = false; ChatStatusText.Text = "正在结合世界数据生成发言…"; UpdateButtons();
            try
            {
                var result = await _bridge.SendAsync("chat_generate", new { topic = ChatTopicBox.Text, profile, preferences = _settings.Preferences });
                if (result.TryGetProperty("skipped", out var skipped) && skipped.GetBoolean()) ChatStatusText.Text = result.GetProperty("reason").GetString();
            }
            catch (Exception error)
            {
                if (_chatCancelRequested) { ChatStatusText.Text = "已取消发言。"; AddLog("info", "已取消生成发言。"); }
                else { ChatStatusText.Text = error.Message; throw; }
            }
            finally { _chatGenerating = false; UpdateButtons(); }
        });
    }
    private async void CancelChatButton_Click(object sender, RoutedEventArgs e) => await Guard(async () =>
    {
        _chatCancelRequested = true;
        await _bridge.SendAsync("chat_cancel", new { }); ChatStatusText.Text = "已请求取消发言。";
    });
    private void ChatSettingsButton_Click(object sender, RoutedEventArgs e)
    {
        NavigateTo("settings");
        ChatSettingsCard.StartBringIntoView();
    }
    private void RestoreChatPromptButton_Click(object sender, RoutedEventArgs e)
    {
        ChatPromptBox.Text = _defaultChatPrompt;
        ShowNotice("已填入默认聊天提示词，点击保存设置后生效。");
    }
    private void SettingsPanel_SizeChanged(object sender, SizeChangedEventArgs e) { UpdateSettingsLayout(); _ = CaptureChatLayoutAsync(); }
    private void ChatPanel_ViewChanged(object sender, ScrollViewerViewChangedEventArgs e) { if (!e.IsIntermediate) _ = CaptureChatLayoutAsync(); }
    private void UpdateSettingsLayout()
    {
        if (SettingsContent is not null && SettingsPanel.ActualWidth > 0)
        {
            SettingsContent.Width = Math.Max(0, Math.Min(760, SettingsPanel.ActualWidth - 16));
            ChatSettingsActions.Orientation = SettingsContent.Width < 400 ? Orientation.Vertical : Orientation.Horizontal;
        }
    }
}
