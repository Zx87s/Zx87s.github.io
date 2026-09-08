using System.Diagnostics;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;

namespace Zx87s.TheSinCollector;

internal static class PathUtil
{
    public static bool IsSameOrChild(string candidate, string parent)
    {
        var c = Path.GetFullPath(candidate).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        var p = Path.GetFullPath(parent).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        if (string.Equals(c, p, StringComparison.OrdinalIgnoreCase))
            return true;

        var prefix = p + Path.DirectorySeparatorChar;
        return c.StartsWith(prefix, StringComparison.OrdinalIgnoreCase);
    }

    public static string SafeFileName(string value)
    {
        var invalid = Path.GetInvalidFileNameChars();
        var chars = value.Select(ch => invalid.Contains(ch) ? '_' : ch).ToArray();
        var result = new string(chars).Trim();
        return string.IsNullOrWhiteSpace(result) ? "unnamed" : result;
    }

    public static string ToSlash(string path) => path.Replace('\\', '/');

    public static string ChangeExtensionSlash(string relativePath, string extension)
    {
        var native = relativePath.Replace('/', Path.DirectorySeparatorChar);
        return ToSlash(Path.ChangeExtension(native, extension));
    }
}

internal static class HashUtil
{
    public static string Sha256Hex(byte[] data) => Convert.ToHexString(SHA256.HashData(data)).ToLowerInvariant();

    public static string Sha256Hex(string text) => Sha256Hex(Encoding.UTF8.GetBytes(text));

    public static string StableTextId(string text) => "TXT-" + Sha256Hex(text)[..14].ToUpperInvariant();

    public static async Task<string> Sha256FileAsync(string path, CancellationToken token)
    {
        await using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 1024 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan);
        var hash = await SHA256.HashDataAsync(stream, token);
        return Convert.ToHexString(hash).ToLowerInvariant();
    }
}

internal static class CsvUtil
{
    public static string Escape(string? value)
    {
        value ??= string.Empty;
        if (value.Contains('"') || value.Contains(',') || value.Contains('\r') || value.Contains('\n'))
            return '"' + value.Replace("\"", "\"\"") + '"';
        return value;
    }

    public static void WriteRows(string path, IEnumerable<IReadOnlyList<string?>> rows)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        using var writer = new StreamWriter(path, false, new UTF8Encoding(encoderShouldEmitUTF8Identifier: true));
        foreach (var row in rows)
            writer.WriteLine(string.Join(',', row.Select(Escape)));
    }
}

internal sealed class LogWriter : IDisposable
{
    private readonly object _gate = new();
    private readonly StreamWriter _writer;
    private readonly IProgress<string> _ui;

    public LogWriter(string path, IProgress<string> ui)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        _writer = new StreamWriter(path, append: false, new UTF8Encoding(true)) { AutoFlush = true };
        _ui = ui;
    }

    public void Info(string message) => Write("INFO", message);
    public void Warn(string message) => Write("WARN", message);
    public void Error(string message) => Write("ERROR", message);

    private void Write(string level, string message)
    {
        var line = $"[{DateTime.Now:HH:mm:ss}] [{level}] {message}";
        lock (_gate)
            _writer.WriteLine(line);
        _ui.Report(line);
    }

    public void Dispose() => _writer.Dispose();
}

internal static class ToolBootstrap
{
    public static string PrepareTool(string resourceName, string fileName)
    {
        var assembly = Assembly.GetExecutingAssembly();
        var version = assembly.GetName().Version?.ToString() ?? "1";
        var dir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Zx87s",
            "TheSinLocalizationCollector",
            "Tools",
            version);
        Directory.CreateDirectory(dir);

        var destination = Path.Combine(dir, fileName);
        if (File.Exists(destination) && new FileInfo(destination).Length > 0)
            return destination;

        using var input = assembly.GetManifestResourceStream(resourceName)
            ?? throw new InvalidOperationException($"Embedded helper '{resourceName}' is missing from this build.");

        var temp = destination + ".tmp";
        using (var output = new FileStream(temp, FileMode.Create, FileAccess.Write, FileShare.None))
            input.CopyTo(output);

        File.Move(temp, destination, overwrite: true);
        return destination;
    }

    public static void ExportTextResource(string resourceName, string destination)
    {
        var assembly = Assembly.GetExecutingAssembly();
        using var input = assembly.GetManifestResourceStream(resourceName)
            ?? throw new InvalidOperationException($"Embedded resource '{resourceName}' is missing from this build.");
        Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
        using var output = new FileStream(destination, FileMode.Create, FileAccess.Write, FileShare.Read);
        input.CopyTo(output);
    }
}

internal static class ProcessRunner
{
    public static async Task<ProcessResult> RunAsync(
        string executable,
        IEnumerable<string> arguments,
        Action<string>? onStdOut,
        Action<string>? onStdErr,
        CancellationToken token,
        string? workingDirectory = null)
    {
        var psi = new ProcessStartInfo
        {
            FileName = executable,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
            WorkingDirectory = workingDirectory ?? Path.GetDirectoryName(executable) ?? Environment.CurrentDirectory,
        };

        foreach (var arg in arguments)
            psi.ArgumentList.Add(arg);

        using var process = new Process { StartInfo = psi, EnableRaisingEvents = true };
        var stdout = new StringBuilder();
        var stderr = new StringBuilder();

        try
        {
            if (!process.Start())
                throw new InvalidOperationException($"Failed to start helper process: {executable}");
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Unable to start '{Path.GetFileName(executable)}': {ex.Message}", ex);
        }

        using var registration = token.Register(() =>
        {
            try
            {
                if (!process.HasExited)
                    process.Kill(entireProcessTree: true);
            }
            catch
            {
                // Best-effort cancellation.
            }
        });

        var stdoutTask = ReadLinesAsync(process.StandardOutput, line =>
        {
            if (stdout.Length < 4_000_000)
                stdout.AppendLine(line);
            onStdOut?.Invoke(line);
        });
        var stderrTask = ReadLinesAsync(process.StandardError, line =>
        {
            if (stderr.Length < 4_000_000)
                stderr.AppendLine(line);
            onStdErr?.Invoke(line);
        });

        await Task.WhenAll(process.WaitForExitAsync(token), stdoutTask, stderrTask);
        token.ThrowIfCancellationRequested();

        return new ProcessResult(process.ExitCode, stdout.ToString(), stderr.ToString());
    }

    private static async Task ReadLinesAsync(StreamReader reader, Action<string> callback)
    {
        while (true)
        {
            var line = await reader.ReadLineAsync();
            if (line is null)
                break;
            callback(line);
        }
    }
}

internal static class FileCopyUtil
{
    public static void CopyPreserveRelative(string sourceRoot, string sourceFile, string destinationRoot)
    {
        var relative = Path.GetRelativePath(sourceRoot, sourceFile);
        var destination = Path.Combine(destinationRoot, relative);
        Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
        File.Copy(sourceFile, destination, overwrite: true);
    }

    public static void CopyIfExists(string source, string destination)
    {
        if (!File.Exists(source))
            return;
        Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
        File.Copy(source, destination, overwrite: true);
    }
}
