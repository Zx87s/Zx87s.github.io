using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Xml;

namespace Zx87s.TheSinCollector;

internal sealed class TextCollector
{
    private readonly Dictionary<string, TextRecord> _records = new(StringComparer.Ordinal);

    public int Count => _records.Count;

    public void Add(string? text, string source, string origin)
    {
        if (string.IsNullOrEmpty(text))
            return;

        var normalized = Normalize(text);
        if (!TextHeuristics.IsEnglishCandidate(normalized))
            return;

        if (!_records.TryGetValue(normalized, out var record))
        {
            record = new TextRecord
            {
                Id = HashUtil.StableTextId(normalized),
                Text = normalized,
                Occurrences = 0,
            };
            _records.Add(normalized, record);
        }

        record.Occurrences++;
        if (!string.IsNullOrWhiteSpace(source))
            record.Sources.Add(source);
        if (!string.IsNullOrWhiteSpace(origin))
            record.Origins.Add(origin);
    }

    public void AddUe4ExtractorFile(string textFile, string sourcePrefix)
    {
        if (!File.Exists(textFile))
            return;

        string currentSource = sourcePrefix;
        string currentKey = string.Empty;
        var body = new StringBuilder();

        void Flush()
        {
            if (string.IsNullOrWhiteSpace(currentKey))
            {
                body.Clear();
                return;
            }

            var source = string.IsNullOrWhiteSpace(currentSource)
                ? currentKey
                : currentSource + " | " + currentKey;
            Add(body.ToString().TrimEnd('\r', '\n'), source, "UE4TextExtractor");
            body.Clear();
        }

        foreach (var rawLine in File.ReadLines(textFile, Encoding.UTF8))
        {
            var line = rawLine ?? string.Empty;
            if (line.StartsWith("=># ", StringComparison.Ordinal))
            {
                Flush();
                currentKey = string.Empty;
                currentSource = sourcePrefix + " | " + line[4..].Trim();
                continue;
            }

            if (line.StartsWith("=>[", StringComparison.Ordinal))
            {
                Flush();
                currentKey = line.Trim();
                continue;
            }

            if (line.StartsWith("=>{", StringComparison.Ordinal))
            {
                Flush();
                currentKey = string.Empty;
                continue;
            }

            if (!string.IsNullOrWhiteSpace(currentKey))
            {
                if (body.Length > 0)
                    body.Append('\n');
                body.Append(line);
            }
        }

        Flush();
    }

    public void AddStructuredFile(string path, string source, LogWriter log)
    {
        var ext = Path.GetExtension(path).ToLowerInvariant();
        try
        {
            switch (ext)
            {
                case ".json":
                case ".manifest":
                case ".archive":
                    ScanJson(path, source);
                    break;
                case ".xml":
                    ScanXml(path, source);
                    break;
                case ".ini":
                case ".int":
                    ScanIni(path, source);
                    break;
                case ".csv":
                    ScanCsv(path, source);
                    break;
                case ".po":
                    ScanPo(path, source);
                    break;
                default:
                    ScanPlainLines(path, source);
                    break;
            }
        }
        catch (Exception ex)
        {
            log.Warn($"Structured scan fallback for '{source}': {ex.Message}");
            try { ScanPlainLines(path, source); } catch { /* keep the run moving */ }
        }
    }

    public int AddRawBinaryFile(string path, string source, CancellationToken token)
    {
        var added = 0;
        foreach (var value in BinaryStringScanner.Scan(path, token))
        {
            var before = Count;
            Add(value, source, "RawHeuristic");
            if (Count > before)
                added++;
        }
        return added;
    }

    public TextExportStats Export(string reportsDirectory)
    {
        Directory.CreateDirectory(reportsDirectory);

        var all = _records.Values
            .OrderBy(r => r.Text, StringComparer.OrdinalIgnoreCase)
            .ThenBy(r => r.Id, StringComparer.Ordinal)
            .ToList();

        var clean = all
            .Where(r => !TextHeuristics.IsLikelyInternal(r.Text))
            .Where(r => r.Origins.Any(o => !string.Equals(o, "RawHeuristic", StringComparison.OrdinalIgnoreCase)))
            .ToList();

        var raw = all
            .Where(r => r.Origins.Contains("RawHeuristic"))
            .ToList();

        CsvUtil.WriteRows(
            Path.Combine(reportsDirectory, "English_Unique_All.csv"),
            BuildRows(all, includeTranslationColumn: false));

        CsvUtil.WriteRows(
            Path.Combine(reportsDirectory, "English_Unique_Clean.csv"),
            BuildRows(clean, includeTranslationColumn: false));

        CsvUtil.WriteRows(
            Path.Combine(reportsDirectory, "English_Raw_Candidates.csv"),
            BuildRows(raw, includeTranslationColumn: false));

        CsvUtil.WriteRows(
            Path.Combine(reportsDirectory, "Translation_Worksheet_AR.csv"),
            BuildRows(clean, includeTranslationColumn: true));

        using (var writer = new StreamWriter(
                   Path.Combine(reportsDirectory, "English_Unique_Clean.txt"),
                   false,
                   new UTF8Encoding(true)))
        {
            foreach (var record in clean)
            {
                writer.WriteLine($"===== {record.Id} =====");
                writer.WriteLine(record.Text);
                writer.WriteLine();
            }
        }

        return new TextExportStats(all.Count, clean.Count, raw.Count);
    }

    private static IEnumerable<IReadOnlyList<string?>> BuildRows(IReadOnlyList<TextRecord> records, bool includeTranslationColumn)
    {
        if (includeTranslationColumn)
        {
            yield return new string?[]
            {
                "ID", "EnglishSource", "ArabicTranslation", "Occurrences", "Category", "DoNotTranslate", "Origins", "Sources"
            };
        }
        else
        {
            yield return new string?[]
            {
                "ID", "SourceText", "Occurrences", "Category", "DoNotTranslate", "Origins", "Sources"
            };
        }

        foreach (var record in records)
        {
            var category = TextHeuristics.Category(record.Text);
            var dnt = TextHeuristics.IsDynamicInputName(record.Text) ? "YES" : "NO";
            var origins = string.Join(" | ", record.Origins.OrderBy(x => x, StringComparer.OrdinalIgnoreCase));
            var sources = string.Join(" | ", record.Sources.OrderBy(x => x, StringComparer.OrdinalIgnoreCase));

            if (includeTranslationColumn)
            {
                yield return new string?[]
                {
                    record.Id, record.Text, string.Empty, record.Occurrences.ToString(), category, dnt, origins, sources
                };
            }
            else
            {
                yield return new string?[]
                {
                    record.Id, record.Text, record.Occurrences.ToString(), category, dnt, origins, sources
                };
            }
        }
    }

    private void ScanJson(string path, string source)
    {
        using var stream = File.OpenRead(path);
        using var doc = JsonDocument.Parse(stream, new JsonDocumentOptions
        {
            AllowTrailingCommas = true,
            CommentHandling = JsonCommentHandling.Skip,
        });
        WalkJson(doc.RootElement, source);
    }

    private void WalkJson(JsonElement element, string source)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.String:
                Add(element.GetString(), source, "StructuredText");
                break;
            case JsonValueKind.Array:
                foreach (var item in element.EnumerateArray())
                    WalkJson(item, source);
                break;
            case JsonValueKind.Object:
                foreach (var prop in element.EnumerateObject())
                    WalkJson(prop.Value, source);
                break;
        }
    }

    private void ScanXml(string path, string source)
    {
        var settings = new XmlReaderSettings
        {
            DtdProcessing = DtdProcessing.Prohibit,
            IgnoreComments = true,
            IgnoreProcessingInstructions = true,
        };
        using var reader = XmlReader.Create(path, settings);
        while (reader.Read())
        {
            if (reader.NodeType == XmlNodeType.Text || reader.NodeType == XmlNodeType.CDATA)
                Add(reader.Value, source, "StructuredText");

            if (reader.NodeType == XmlNodeType.Element && reader.HasAttributes)
            {
                while (reader.MoveToNextAttribute())
                    Add(reader.Value, source, "StructuredText");
                reader.MoveToElement();
            }
        }
    }

    private void ScanIni(string path, string source)
    {
        foreach (var raw in File.ReadLines(path, Encoding.UTF8))
        {
            var line = raw.Trim();
            if (line.Length == 0 || line.StartsWith(';') || line.StartsWith('#') || line.StartsWith('['))
                continue;
            var eq = line.IndexOf('=');
            Add(eq >= 0 ? line[(eq + 1)..].Trim() : line, source, "StructuredText");
        }
    }

    private void ScanCsv(string path, string source)
    {
        foreach (var line in File.ReadLines(path, Encoding.UTF8))
        {
            foreach (var cell in ParseCsvLine(line))
                Add(cell, source, "StructuredText");
        }
    }

    private void ScanPo(string path, string source)
    {
        var current = new StringBuilder();
        var readingMsgId = false;

        void Flush()
        {
            if (readingMsgId && current.Length > 0)
                Add(current.ToString(), source, "StructuredText");
            current.Clear();
            readingMsgId = false;
        }

        foreach (var raw in File.ReadLines(path, Encoding.UTF8))
        {
            var line = raw.Trim();
            if (line.StartsWith("msgid ", StringComparison.Ordinal))
            {
                Flush();
                readingMsgId = true;
                current.Append(DecodeQuoted(line[6..].Trim()));
                continue;
            }

            if (readingMsgId && line.StartsWith('"'))
            {
                current.Append(DecodeQuoted(line));
                continue;
            }

            if (readingMsgId && line.Length == 0)
                Flush();
        }

        Flush();
    }

    private void ScanPlainLines(string path, string source)
    {
        foreach (var line in File.ReadLines(path, Encoding.UTF8))
            Add(line, source, "StructuredText");
    }

    private static IEnumerable<string> ParseCsvLine(string line)
    {
        var cell = new StringBuilder();
        var quoted = false;
        for (var i = 0; i < line.Length; i++)
        {
            var ch = line[i];
            if (ch == '"')
            {
                if (quoted && i + 1 < line.Length && line[i + 1] == '"')
                {
                    cell.Append('"');
                    i++;
                }
                else
                {
                    quoted = !quoted;
                }
            }
            else if (ch == ',' && !quoted)
            {
                yield return cell.ToString();
                cell.Clear();
            }
            else
            {
                cell.Append(ch);
            }
        }
        yield return cell.ToString();
    }

    private static string DecodeQuoted(string value)
    {
        try
        {
            if (value.Length >= 2 && value[0] == '"' && value[^1] == '"')
                return JsonSerializer.Deserialize<string>(value) ?? string.Empty;
        }
        catch { }
        return value.Trim('"');
    }

    private static string Normalize(string value)
    {
        return value
            .Replace("\r\n", "\n", StringComparison.Ordinal)
            .Replace('\r', '\n')
            .Trim('\0', '\uFEFF');
    }
}

internal sealed record TextExportStats(int All, int Clean, int Raw);

internal static class TextHeuristics
{
    private static readonly Regex Latin = new("[A-Za-z]", RegexOptions.Compiled | RegexOptions.CultureInvariant);
    private static readonly Regex GuidLike = new("^[{(]?[0-9A-Fa-f]{8}[-_][0-9A-Fa-f]{4}[-_][0-9A-Fa-f]{4}[-_][0-9A-Fa-f]{4}[-_][0-9A-Fa-f]{12}[)}]?$", RegexOptions.Compiled);
    private static readonly HashSet<string> InputNames = new(StringComparer.OrdinalIgnoreCase)
    {
        "Space", "SpaceBar", "Enter", "Return", "Escape", "Esc", "Tab", "Backspace", "Delete", "Insert",
        "Home", "End", "PageUp", "PageDown", "LeftShift", "RightShift", "Shift", "LeftControl", "RightControl",
        "Control", "Ctrl", "LeftAlt", "RightAlt", "Alt", "CapsLock", "NumLock", "ScrollLock", "Up", "Down",
        "Left", "Right", "LeftMouseButton", "RightMouseButton", "MiddleMouseButton", "MouseScrollUp", "MouseScrollDown",
        "MouseX", "MouseY", "ThumbMouseButton", "ThumbMouseButton2"
    };

    public static bool IsEnglishCandidate(string value)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > 8_000 || !Latin.IsMatch(value))
            return false;

        var controls = value.Count(ch => char.IsControl(ch) && ch != '\n' && ch != '\t');
        if (controls > Math.Max(2, value.Length / 20))
            return false;

        return true;
    }

    public static bool IsLikelyInternal(string value)
    {
        var t = value.Trim();
        if (t.Length == 0)
            return true;

        if (GuidLike.IsMatch(t))
            return true;

        if (t.StartsWith("/Game/", StringComparison.OrdinalIgnoreCase) ||
            t.StartsWith("/Script/", StringComparison.OrdinalIgnoreCase) ||
            t.StartsWith("Default__", StringComparison.OrdinalIgnoreCase) ||
            t.Contains("BlueprintGeneratedClass", StringComparison.OrdinalIgnoreCase) ||
            t.Contains("Class'/", StringComparison.OrdinalIgnoreCase) ||
            t.Contains("Texture2D'/", StringComparison.OrdinalIgnoreCase) ||
            t.Contains("Material'/", StringComparison.OrdinalIgnoreCase))
            return true;

        if (Regex.IsMatch(t, @"^[A-Za-z0-9_./\\:-]+\.(uasset|uexp|umap|ubulk|uptnl|png|jpg|jpeg|tga|dds|wav|ogg|wem|bnk)$", RegexOptions.IgnoreCase))
            return true;

        if (t.Contains('/') && !t.Contains(' ') && t.Length > 18)
            return true;

        if (Regex.IsMatch(t, @"^[A-Za-z_][A-Za-z0-9_]{28,}$") && !t.Contains(' '))
            return true;

        return false;
    }

    public static bool IsDynamicInputName(string value)
    {
        var t = value.Trim();
        if (InputNames.Contains(t))
            return true;

        if (Regex.IsMatch(t, @"^F([1-9]|1[0-2])$", RegexOptions.IgnoreCase))
            return true;

        return t.Contains("MouseButton", StringComparison.OrdinalIgnoreCase) ||
               t.Contains("Gamepad_", StringComparison.OrdinalIgnoreCase) ||
               t.Contains("EKeys::", StringComparison.OrdinalIgnoreCase) ||
               t.Contains("{Key}", StringComparison.OrdinalIgnoreCase) ||
               t.Contains("<Key>", StringComparison.OrdinalIgnoreCase) ||
               t.Contains("[Key]", StringComparison.OrdinalIgnoreCase);
    }

    public static string Category(string value)
    {
        if (IsDynamicInputName(value))
            return "InputBinding";
        if (value.Contains('{') || value.Contains('<') || Regex.IsMatch(value, @"%[sdif]"))
            return "Formatted/Placeholder";
        if (value.Contains('\n') || value.Length >= 120)
            return "Dialogue/LongText";
        if (value.Length <= 40)
            return "UI/ShortText";
        return "GeneralText";
    }
}

internal static class BinaryStringScanner
{
    private const int MaxFileRead = 128 * 1024 * 1024;
    private const int MaxMatches = 4_000;

    public static IEnumerable<string> Scan(string path, CancellationToken token)
    {
        byte[] bytes;
        var info = new FileInfo(path);
        if (info.Length <= MaxFileRead)
        {
            bytes = File.ReadAllBytes(path);
        }
        else
        {
            // Large cooked assets are usually media/bulk payloads. Scan representative windows instead of allocating gigabytes.
            const int head = 64 * 1024 * 1024;
            const int tail = 16 * 1024 * 1024;
            bytes = new byte[head + tail];
            using var stream = File.OpenRead(path);
            var headRead = stream.Read(bytes, 0, head);
            stream.Seek(Math.Max(0, info.Length - tail), SeekOrigin.Begin);
            var tailRead = stream.Read(bytes, headRead, tail);
            if (headRead + tailRead != bytes.Length)
                Array.Resize(ref bytes, headRead + tailRead);
        }

        var seen = new HashSet<string>(StringComparer.Ordinal);
        var yielded = 0;

        foreach (var s in ScanAscii(bytes))
        {
            token.ThrowIfCancellationRequested();
            var candidate = s.Trim();
            if (!LooksHumanish(candidate) || !seen.Add(candidate))
                continue;
            yield return candidate;
            if (++yielded >= MaxMatches)
                yield break;
        }

        foreach (var s in ScanUtf16Le(bytes, 0).Concat(ScanUtf16Le(bytes, 1)))
        {
            token.ThrowIfCancellationRequested();
            var candidate = s.Trim();
            if (!LooksHumanish(candidate) || !seen.Add(candidate))
                continue;
            yield return candidate;
            if (++yielded >= MaxMatches)
                yield break;
        }
    }

    private static IEnumerable<string> ScanAscii(byte[] data)
    {
        var sb = new StringBuilder();
        foreach (var b in data)
        {
            if (b is >= 0x20 and <= 0x7E)
            {
                if (sb.Length < 1_024)
                    sb.Append((char)b);
            }
            else
            {
                if (sb.Length >= 4)
                    yield return sb.ToString();
                sb.Clear();
            }
        }
        if (sb.Length >= 4)
            yield return sb.ToString();
    }

    private static IEnumerable<string> ScanUtf16Le(byte[] data, int alignment)
    {
        var sb = new StringBuilder();
        for (var i = alignment; i + 1 < data.Length; i += 2)
        {
            var lo = data[i];
            var hi = data[i + 1];
            if (hi == 0 && lo is >= 0x20 and <= 0x7E)
            {
                if (sb.Length < 1_024)
                    sb.Append((char)lo);
            }
            else
            {
                if (sb.Length >= 4)
                    yield return sb.ToString();
                sb.Clear();
            }
        }
        if (sb.Length >= 4)
            yield return sb.ToString();
    }

    private static bool LooksHumanish(string value)
    {
        if (!TextHeuristics.IsEnglishCandidate(value) || value.Length > 1_000)
            return false;

        if (Regex.IsMatch(value, @"^[0-9A-Fa-f]{24,}$"))
            return false;

        var alpha = value.Count(char.IsLetter);
        var separators = value.Count(ch => ch == '_' || ch == '/' || ch == '\\');
        if (separators > value.Length / 2 && !value.Contains(' '))
            return false;

        return alpha >= 2;
    }
}
