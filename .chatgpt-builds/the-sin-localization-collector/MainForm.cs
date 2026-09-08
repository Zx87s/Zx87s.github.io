using System.Diagnostics;

namespace Zx87s.TheSinCollector;

internal sealed class MainForm : Form
{
    private readonly TextBox _paksPath = new();
    private readonly TextBox _outputPath = new();
    private readonly TextBox _aesKey = new();
    private readonly CheckBox _showAes = new();
    private readonly CheckBox _rawFallback = new();
    private readonly CheckBox _keepWork = new();
    private readonly CheckBox _mediumAtlas = new();
    private readonly Button _runButton = new();
    private readonly Button _cancelButton = new();
    private readonly Button _openOutputButton = new();
    private readonly ProgressBar _progress = new();
    private readonly Label _stageLabel = new();
    private readonly Label _countLabel = new();
    private readonly TextBox _log = new();

    private CancellationTokenSource? _cts;
    private string? _lastRunDirectory;
    private bool _outputWasEdited;

    public MainForm()
    {
        Text = "Zx87s - TheSin Localization Collector";
        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(900, 700);
        Size = new Size(1040, 790);
        Font = new Font("Segoe UI", 9.5f, FontStyle.Regular, GraphicsUnit.Point);
        AutoScaleMode = AutoScaleMode.Dpi;

        BuildUi();
        ApplyDefaults();
    }

    private void BuildUi()
    {
        var root = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            Padding = new Padding(18),
            ColumnCount = 1,
            RowCount = 8,
        };
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));

        var title = new Label
        {
            Text = "TheSin Localization Asset Collector",
            AutoSize = true,
            Font = new Font(Font.FontFamily, 18f, FontStyle.Bold),
            Margin = new Padding(0, 0, 0, 4),
        };
        var subtitle = new Label
        {
            Text = "Read-only Unreal Engine PAK analysis for unique English text, fonts, font data and UI/atlas candidates.",
            AutoSize = true,
            ForeColor = SystemColors.GrayText,
            Margin = new Padding(0, 0, 0, 16),
        };
        var header = new FlowLayoutPanel { AutoSize = true, FlowDirection = FlowDirection.TopDown, Dock = DockStyle.Fill };
        header.Controls.Add(title);
        header.Controls.Add(subtitle);
        root.Controls.Add(header);

        root.Controls.Add(BuildPathRow("PAKs directory", _paksPath, BrowsePaks));
        root.Controls.Add(BuildPathRow("Output directory", _outputPath, BrowseOutput));

        var aesPanel = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            AutoSize = true,
            ColumnCount = 3,
            Margin = new Padding(0, 6, 0, 6),
        };
        aesPanel.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 140));
        aesPanel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        aesPanel.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        aesPanel.Controls.Add(new Label { Text = "AES key (optional)", Anchor = AnchorStyles.Left, AutoSize = true }, 0, 0);
        _aesKey.Dock = DockStyle.Fill;
        _aesKey.UseSystemPasswordChar = true;
        _aesKey.PlaceholderText = "64 hex characters / 0x... / base64";
        aesPanel.Controls.Add(_aesKey, 1, 0);
        _showAes.Text = "Show";
        _showAes.AutoSize = true;
        _showAes.CheckedChanged += (_, _) => _aesKey.UseSystemPasswordChar = !_showAes.Checked;
        aesPanel.Controls.Add(_showAes, 2, 0);
        root.Controls.Add(aesPanel);

        var options = new GroupBox
        {
            Text = "Collection options",
            Dock = DockStyle.Fill,
            AutoSize = true,
            Padding = new Padding(12),
            Margin = new Padding(0, 8, 0, 10),
        };
        var optionFlow = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill,
            AutoSize = true,
            FlowDirection = FlowDirection.TopDown,
            WrapContents = false,
        };
        _rawFallback.Text = "Enable deep ASCII/UTF-16 fallback scan for strings missed by structured UE parsing";
        _rawFallback.Checked = true;
        _rawFallback.AutoSize = true;
        _mediumAtlas.Text = "Collect medium-confidence UI/atlas candidates in addition to high-confidence atlas assets";
        _mediumAtlas.Checked = true;
        _mediumAtlas.AutoSize = true;
        _keepWork.Text = "Keep temporary extracted working files after the reports are generated";
        _keepWork.Checked = false;
        _keepWork.AutoSize = true;
        optionFlow.Controls.Add(_rawFallback);
        optionFlow.Controls.Add(_mediumAtlas);
        optionFlow.Controls.Add(_keepWork);
        options.Controls.Add(optionFlow);
        root.Controls.Add(options);

        var buttons = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill,
            AutoSize = true,
            FlowDirection = FlowDirection.LeftToRight,
            Margin = new Padding(0, 2, 0, 10),
        };
        _runButton.Text = "ANALYZE & COLLECT";
        _runButton.AutoSize = true;
        _runButton.Padding = new Padding(14, 6, 14, 6);
        _runButton.Click += RunClicked;
        _cancelButton.Text = "Cancel";
        _cancelButton.AutoSize = true;
        _cancelButton.Padding = new Padding(8, 6, 8, 6);
        _cancelButton.Enabled = false;
        _cancelButton.Click += (_, _) => _cts?.Cancel();
        _openOutputButton.Text = "Open last output";
        _openOutputButton.AutoSize = true;
        _openOutputButton.Padding = new Padding(8, 6, 8, 6);
        _openOutputButton.Enabled = false;
        _openOutputButton.Click += (_, _) => OpenLastOutput();
        buttons.Controls.Add(_runButton);
        buttons.Controls.Add(_cancelButton);
        buttons.Controls.Add(_openOutputButton);
        root.Controls.Add(buttons);

        var status = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            AutoSize = true,
            ColumnCount = 1,
            Margin = new Padding(0, 0, 0, 8),
        };
        _stageLabel.Text = "Ready.";
        _stageLabel.AutoSize = true;
        _stageLabel.Font = new Font(Font, FontStyle.Bold);
        _countLabel.Text = "0%";
        _countLabel.AutoSize = true;
        _countLabel.ForeColor = SystemColors.GrayText;
        _progress.Minimum = 0;
        _progress.Maximum = 100;
        _progress.Value = 0;
        _progress.Dock = DockStyle.Fill;
        _progress.Height = 23;
        status.Controls.Add(_stageLabel);
        status.Controls.Add(_countLabel);
        status.Controls.Add(_progress);
        root.Controls.Add(status);

        _log.Dock = DockStyle.Fill;
        _log.Multiline = true;
        _log.ReadOnly = true;
        _log.ScrollBars = ScrollBars.Vertical;
        _log.WordWrap = false;
        _log.Font = new Font("Consolas", 9f);
        _log.BackColor = SystemColors.Window;
        root.Controls.Add(_log);

        Controls.Add(root);

        _paksPath.TextChanged += (_, _) =>
        {
            if (!_outputWasEdited)
            {
                var suggestion = SuggestOutputPath(_paksPath.Text.Trim());
                if (!string.IsNullOrWhiteSpace(suggestion))
                    _outputPath.Text = suggestion;
            }
        };
        _outputPath.TextChanged += (_, _) =>
        {
            if (_outputPath.Focused)
                _outputWasEdited = true;
        };
    }

    private Control BuildPathRow(string labelText, TextBox box, EventHandler browseHandler)
    {
        var panel = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            AutoSize = true,
            ColumnCount = 3,
            Margin = new Padding(0, 6, 0, 6),
        };
        panel.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 140));
        panel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        panel.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));

        var label = new Label { Text = labelText, AutoSize = true, Anchor = AnchorStyles.Left };
        box.Dock = DockStyle.Fill;
        var browse = new Button { Text = "Browse...", AutoSize = true, Margin = new Padding(8, 0, 0, 0) };
        browse.Click += browseHandler;

        panel.Controls.Add(label, 0, 0);
        panel.Controls.Add(box, 1, 0);
        panel.Controls.Add(browse, 2, 0);
        return panel;
    }

    private void ApplyDefaults()
    {
        const string requestedPath = @"E:\New folder\Ebola\TheSin\Content\Paks";
        _paksPath.Text = requestedPath;
        _outputPath.Text = SuggestOutputPath(requestedPath);
        _outputWasEdited = false;
    }

    private static string SuggestOutputPath(string paksPath)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(paksPath))
                return string.Empty;

            var paks = new DirectoryInfo(paksPath);
            var gameRoot = paks.Parent?.Parent;
            if (gameRoot is not null)
                return Path.Combine(gameRoot.FullName, "Zx87s_Localization_Collector_Output");

            return Path.Combine(paks.FullName, "..", "Zx87s_Localization_Collector_Output");
        }
        catch
        {
            return string.Empty;
        }
    }

    private void BrowsePaks(object? sender, EventArgs e)
    {
        using var dialog = new FolderBrowserDialog
        {
            Description = "Select the Unreal Engine Content\\Paks directory",
            ShowNewFolderButton = false,
        };
        if (Directory.Exists(_paksPath.Text))
            dialog.SelectedPath = _paksPath.Text;
        if (dialog.ShowDialog(this) == DialogResult.OK)
            _paksPath.Text = dialog.SelectedPath;
    }

    private void BrowseOutput(object? sender, EventArgs e)
    {
        using var dialog = new FolderBrowserDialog
        {
            Description = "Select a safe output directory outside the Paks folder",
            ShowNewFolderButton = true,
        };
        if (Directory.Exists(_outputPath.Text))
            dialog.SelectedPath = _outputPath.Text;
        if (dialog.ShowDialog(this) == DialogResult.OK)
        {
            _outputWasEdited = true;
            _outputPath.Text = dialog.SelectedPath;
        }
    }

    private async void RunClicked(object? sender, EventArgs e)
    {
        if (!TryBuildOptions(out var options, out var error))
        {
            MessageBox.Show(this, error, "Validation Error", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }

        _cts?.Dispose();
        _cts = new CancellationTokenSource();
        SetRunningState(true);
        _log.Clear();
        _lastRunDirectory = null;
        _openOutputButton.Enabled = false;

        var progress = new Progress<ProgressInfo>(UpdateProgress);
        var log = new Progress<string>(AppendLog);

        try
        {
            var engine = new CollectorEngine(options!, progress, log);
            _lastRunDirectory = await engine.RunAsync(_cts.Token);
            _openOutputButton.Enabled = Directory.Exists(_lastRunDirectory);
            UpdateProgress(new ProgressInfo(100, "Completed", "All reports and collected assets are ready."));
            MessageBox.Show(
                this,
                "Collection completed successfully.\n\nThe game files were not modified.",
                "Completed",
                MessageBoxButtons.OK,
                MessageBoxIcon.Information);
        }
        catch (OperationCanceledException)
        {
            UpdateProgress(new ProgressInfo(_progress.Value, "Cancelled", "The current run was cancelled. Partial output was preserved."));
            AppendLog("[CANCELLED] The run was cancelled by the user.");
        }
        catch (Exception ex)
        {
            UpdateProgress(new ProgressInfo(_progress.Value, "Failed", ex.Message));
            AppendLog("[ERROR] " + ex);
            MessageBox.Show(this, ex.Message, "Collection Failed", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        finally
        {
            SetRunningState(false);
        }
    }

    private bool TryBuildOptions(out CollectorOptions? options, out string error)
    {
        options = null;
        error = string.Empty;

        var paks = _paksPath.Text.Trim();
        var output = _outputPath.Text.Trim();
        var aes = string.IsNullOrWhiteSpace(_aesKey.Text) ? null : _aesKey.Text.Trim();

        if (!Directory.Exists(paks))
        {
            error = "The PAKs directory does not exist.";
            return false;
        }

        var pakFiles = Directory.GetFiles(paks, "*.pak", SearchOption.TopDirectoryOnly);
        if (pakFiles.Length == 0)
        {
            var hasIoStore = Directory.GetFiles(paks, "*.utoc", SearchOption.TopDirectoryOnly).Length > 0;
            error = hasIoStore
                ? "No .pak files were found. This directory appears to use IoStore (.utoc/.ucas), which requires a different extraction backend."
                : "No .pak files were found in the selected directory.";
            return false;
        }

        if (string.IsNullOrWhiteSpace(output))
        {
            error = "Select an output directory.";
            return false;
        }

        try
        {
            var fullPaks = Path.GetFullPath(paks).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            var fullOutput = Path.GetFullPath(output).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            if (PathUtil.IsSameOrChild(fullOutput, fullPaks))
            {
                error = "For safety, the output directory must be outside the game's Paks directory.";
                return false;
            }
        }
        catch (Exception ex)
        {
            error = "Invalid path: " + ex.Message;
            return false;
        }

        options = new CollectorOptions(paks, output, aes, _rawFallback.Checked, _keepWork.Checked, _mediumAtlas.Checked);
        return true;
    }

    private void SetRunningState(bool running)
    {
        _runButton.Enabled = !running;
        _cancelButton.Enabled = running;
        _paksPath.Enabled = !running;
        _outputPath.Enabled = !running;
        _aesKey.Enabled = !running;
        _rawFallback.Enabled = !running;
        _keepWork.Enabled = !running;
        _mediumAtlas.Enabled = !running;
    }

    private void UpdateProgress(ProgressInfo info)
    {
        var value = Math.Clamp(info.Percent, 0, 100);
        _progress.Value = value;
        _stageLabel.Text = string.IsNullOrWhiteSpace(info.Current)
            ? info.Stage
            : $"{info.Stage} — {info.Current}";
        _countLabel.Text = info.Total > 0
            ? $"{value}%   |   {info.Processed:N0} / {info.Total:N0}"
            : $"{value}%";
    }

    private void AppendLog(string message)
    {
        if (string.IsNullOrWhiteSpace(message))
            return;

        if (_log.TextLength > 2_000_000)
            _log.Clear();

        _log.AppendText(message.TrimEnd() + Environment.NewLine);
        _log.SelectionStart = _log.TextLength;
        _log.ScrollToCaret();
    }

    private void OpenLastOutput()
    {
        if (string.IsNullOrWhiteSpace(_lastRunDirectory) || !Directory.Exists(_lastRunDirectory))
            return;

        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = _lastRunDirectory,
                UseShellExecute = true,
            });
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, ex.Message, "Unable to Open Output", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }
}
