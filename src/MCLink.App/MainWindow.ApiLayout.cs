using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace MCLink.App;
public sealed partial class MainWindow
{
    private void ApiPanel_SizeChanged(object sender, SizeChangedEventArgs e)
    {
        UpdateApiLayout();
        _ = CaptureApiLayoutAsync();
    }
    private void ApiPanel_ViewChanged(object sender, ScrollViewerViewChangedEventArgs e)
    {
        if (!e.IsIntermediate) _ = CaptureApiLayoutAsync();
    }

    private void UpdateApiLayout()
    {
        if (ApiContent is null || ApiPanel.ActualWidth <= 0) return;
        var width = Math.Min(1050, Math.Max(0, ApiPanel.ActualWidth - 16));
        ApiContent.Width = width;
        var sideBySide = width >= 820;
        ApiProfilesColumn.Width = new GridLength(sideBySide ? 260 : 0);
        ApiGapColumn.Width = new GridLength(sideBySide ? 18 : 0);
        ApiWorkspace.RowSpacing = sideBySide ? 0 : 18;
        Grid.SetColumnSpan(ApiProfilesCard, sideBySide ? 1 : 3);
        Grid.SetRow(ApiEditorCard, sideBySide ? 0 : 1);
        Grid.SetColumn(ApiEditorCard, sideBySide ? 2 : 0);
        Grid.SetColumnSpan(ApiEditorCard, sideBySide ? 1 : 3);
        ProfilesList.MinHeight = sideBySide ? 150 : 64;
        ProfilesList.MaxHeight = sideBySide ? 440 : 150;

        var editorWidth = width - (sideBySide ? 278 : 0) - 42;
        var compact = editorWidth < 440;
        ApiPresetColumn.Width = compact ? new GridLength(0) : GridLength.Auto;
        ApiEditorHeader.RowSpacing = compact ? 8 : 0;
        Grid.SetRow(PresetCombo, compact ? 1 : 0);
        Grid.SetColumn(PresetCombo, compact ? 0 : 1);
        PresetCombo.HorizontalAlignment = compact ? HorizontalAlignment.Stretch : HorizontalAlignment.Right;
        ApiReadModelsColumn.Width = compact ? new GridLength(0) : GridLength.Auto;
        ApiModelRow.ColumnSpacing = compact ? 0 : 10;
        ApiModelRow.RowSpacing = compact ? 8 : 0;
        Grid.SetRow(LoadModelsButton, compact ? 1 : 0);
        Grid.SetColumn(LoadModelsButton, compact ? 0 : 1);
        LoadModelsButton.HorizontalAlignment = compact ? HorizontalAlignment.Stretch : HorizontalAlignment.Right;

        var stackParameters = editorWidth < 380;
        ApiTemperatureColumn.Width = stackParameters ? new GridLength(0) : new GridLength(1, GridUnitType.Star);
        ApiAdvancedGrid.ColumnSpacing = stackParameters ? 0 : 12;
        ApiAdvancedGrid.RowSpacing = stackParameters ? 12 : 0;
        Grid.SetRow(TemperatureBox, stackParameters ? 1 : 0);
        Grid.SetColumn(TemperatureBox, stackParameters ? 0 : 1);

        var stackActions = editorWidth < 320;
        ApiSaveColumn.Width = stackActions ? new GridLength(1, GridUnitType.Star) : GridLength.Auto;
        ApiTestColumn.Width = ApiDeleteColumn.Width = stackActions ? new GridLength(0) : GridLength.Auto;
        ApiActions.ColumnSpacing = stackActions ? 0 : 8;
        ApiActions.RowSpacing = stackActions ? 8 : 0;
        Grid.SetRow(TestApiButton, stackActions ? 1 : 0);
        Grid.SetColumn(TestApiButton, stackActions ? 0 : 1);
        Grid.SetRow(DeleteProfileButton, stackActions ? 2 : 0);
        Grid.SetColumn(DeleteProfileButton, stackActions ? 0 : 2);
        foreach (var button in new[] { SaveProfileButton, TestApiButton, DeleteProfileButton })
            button.HorizontalAlignment = stackActions ? HorizontalAlignment.Stretch : HorizontalAlignment.Left;
    }
}
