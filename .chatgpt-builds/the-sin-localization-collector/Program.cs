using System.Diagnostics;

namespace Zx87s.TheSinCollector;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();

        Application.ThreadException += (_, e) =>
        {
            MessageBox.Show(
                e.Exception.ToString(),
                "Unexpected UI Error",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        };

        AppDomain.CurrentDomain.UnhandledException += (_, e) =>
        {
            try
            {
                var text = e.ExceptionObject?.ToString() ?? "Unknown fatal error.";
                MessageBox.Show(text, "Fatal Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            catch
            {
                // Last-resort handler: never throw from an unhandled-exception callback.
            }
        };

        Application.Run(new MainForm());
    }
}
