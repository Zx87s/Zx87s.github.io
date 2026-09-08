using System.Buffers.Binary;
using System.Text;

namespace Zx87s.TheSinCollector;

internal static class AssetAnalyzer
{
    private static readonly string[] RawFontExtensions = { ".ttf", ".otf", ".ttc", ".woff", ".woff2" };
    private static readonly string[] RawImageExtensions = { ".png", ".dds", ".tga", ".jpg", ".jpeg", ".bmp", ".webp" };

    private static readonly string[] FontMarkers =
    {
        "FontFace", "CompositeFont", "SlateFontInfo", "Typeface", "FontBulkData", "FontData"
    };

    private static readonly string[] AtlasMarkers =
    {
        "TextureAtlas", "FontAtlas", "SpriteAtlas", "PaperSpriteAtlas", "PaperSprite", "SlateTextureAtlas", "Texture2D"
    };

    public static List<AssetCandidate> AnalyzeCookedAssets(PakContext pak, LogWriter log)
    {
        var result = new List<AssetCandidate>();
        var uassets = Directory.Exists(pak.ExtractedDirectory)
            ? Directory.EnumerateFiles(pak.ExtractedDirectory, "*.uasset", SearchOption.AllDirectories).ToList()
            : new List<string>();

        foreach (var uasset in uassets)
        {
            var relative = PathUtil.ToSlash(Path.GetRelativePath(pak.ExtractedDirectory, uasset));
            var baseRelative = PathUtil.ChangeExtensionSlash(relative, string.Empty).TrimEnd('.');
            var uexp = Path.ChangeExtension(uasset, ".uexp");

            var fontReasons = new List<string>();
            var fontScore = ScorePathForFont(relative, fontReasons);
            fontScore += ScoreMarkers(uasset, uexp, FontMarkers, fontReasons, fontMode: true);
            if (fontScore >= 4)
            {
                result.Add(new AssetCandidate(
                    pak.PakName,
                    baseRelative,
                    "FontAsset",
                    fontScore >= 7 ? "High" : "Medium",
                    fontScore,
                    string.Join("; ", fontReasons.Distinct(StringComparer.OrdinalIgnoreCase))));
            }

            var atlasReasons = new List<string>();
            var atlasScore = ScorePathForAtlas(relative, atlasReasons);
            atlasScore += ScoreMarkers(uasset, uexp, AtlasMarkers, atlasReasons, fontMode: false);
            if (atlasScore >= 4)
            {
                result.Add(new AssetCandidate(
                    pak.PakName,
                    baseRelative,
                    "AtlasAsset",
                    atlasScore >= 7 ? "High" : "Medium",
                    atlasScore,
                    string.Join("; ", atlasReasons.Distinct(StringComparer.OrdinalIgnoreCase))));
            }
        }

        log.Info($"{pak.PakName}: classified {result.Count(c => c.CandidateType == "FontAsset")} font assets and {result.Count(c => c.CandidateType == "AtlasAsset")} atlas/UI assets.");
        return result;
    }

    public static IReadOnlyList<string> FindCompanionBulkEntries(PakContext pak, IEnumerable<AssetCandidate> candidates)
    {
        var entryMap = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var entry in pak.Entries)
            entryMap[entry] = entry;

        var wanted = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var candidate in candidates)
        {
            foreach (var ext in new[] { ".ubulk", ".uptnl" })
            {
                var path = candidate.BaseRelativePath + ext;
                if (entryMap.TryGetValue(path, out var exact))
                    wanted.Add(exact);
            }
        }
        return wanted.OrderBy(x => x, StringComparer.OrdinalIgnoreCase).ToList();
    }

    public static int CopyRawFonts(PakContext pak, string fontsRoot)
    {
        if (!Directory.Exists(pak.ExtractedDirectory))
            return 0;

        var destinationRoot = Path.Combine(fontsRoot, "Raw", PathUtil.SafeFileName(Path.GetFileNameWithoutExtension(pak.PakName)));
        var count = 0;
        foreach (var file in Directory.EnumerateFiles(pak.ExtractedDirectory, "*", SearchOption.AllDirectories))
        {
            if (!RawFontExtensions.Contains(Path.GetExtension(file), StringComparer.OrdinalIgnoreCase))
                continue;
            FileCopyUtil.CopyPreserveRelative(pak.ExtractedDirectory, file, destinationRoot);
            count++;
        }
        return count;
    }

    public static int CopyRawAtlasImages(PakContext pak, string atlasRoot)
    {
        if (!Directory.Exists(pak.ExtractedDirectory))
            return 0;

        var destinationRoot = Path.Combine(atlasRoot, "RawImages", PathUtil.SafeFileName(Path.GetFileNameWithoutExtension(pak.PakName)));
        var count = 0;
        foreach (var file in Directory.EnumerateFiles(pak.ExtractedDirectory, "*", SearchOption.AllDirectories))
        {
            if (!RawImageExtensions.Contains(Path.GetExtension(file), StringComparer.OrdinalIgnoreCase))
                continue;

            var relative = PathUtil.ToSlash(Path.GetRelativePath(pak.ExtractedDirectory, file));
            if (!IsAtlasishPath(relative))
                continue;

            FileCopyUtil.CopyPreserveRelative(pak.ExtractedDirectory, file, destinationRoot);
            count++;
        }
        return count;
    }

    public static void CopyCookedCandidates(
        PakContext pak,
        IEnumerable<AssetCandidate> candidates,
        string fontsRoot,
        string atlasRoot,
        bool includeMediumAtlas)
    {
        var safePak = PathUtil.SafeFileName(Path.GetFileNameWithoutExtension(pak.PakName));
        foreach (var candidate in candidates)
        {
            if (candidate.CandidateType == "AtlasAsset" &&
                candidate.Confidence == "Medium" &&
                !includeMediumAtlas)
                continue;

            var targetRoot = candidate.CandidateType == "FontAsset"
                ? Path.Combine(fontsRoot, "CookedAssets", safePak)
                : Path.Combine(atlasRoot, "CookedAssets", safePak);

            foreach (var ext in new[] { ".uasset", ".uexp", ".ubulk", ".uptnl" })
            {
                var relative = candidate.BaseRelativePath + ext;
                var source = Path.Combine(pak.ExtractedDirectory, relative.Replace('/', Path.DirectorySeparatorChar));
                if (!File.Exists(source))
                    continue;
                var destination = Path.Combine(targetRoot, relative.Replace('/', Path.DirectorySeparatorChar));
                FileCopyUtil.CopyIfExists(source, destination);
            }
        }
    }

    public static List<CarvedFontResult> CarveEmbeddedFonts(
        PakContext pak,
        IEnumerable<AssetCandidate> candidates,
        string fontsRoot,
        CancellationToken token,
        LogWriter log)
    {
        var results = new List<CarvedFontResult>();
        var seenHashes = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var carvedRoot = Path.Combine(fontsRoot, "CarvedFonts");
        Directory.CreateDirectory(carvedRoot);

        foreach (var candidate in candidates.Where(c => c.CandidateType == "FontAsset"))
        {
            foreach (var ext in new[] { ".uasset", ".uexp", ".ubulk" })
            {
                token.ThrowIfCancellationRequested();
                var relative = candidate.BaseRelativePath + ext;
                var source = Path.Combine(pak.ExtractedDirectory, relative.Replace('/', Path.DirectorySeparatorChar));
                if (!File.Exists(source))
                    continue;

                var info = new FileInfo(source);
                if (info.Length <= 0 || info.Length > 256L * 1024 * 1024)
                {
                    if (info.Length > 256L * 1024 * 1024)
                        log.Warn($"Skipping font carving for very large asset: {pak.PakName} | {relative}");
                    continue;
                }

                var bytes = File.ReadAllBytes(source);
                foreach (var carved in FontCarver.FindFonts(bytes))
                {
                    token.ThrowIfCancellationRequested();
                    var payload = bytes.AsSpan(carved.Offset, carved.Length).ToArray();
                    var hash = HashUtil.Sha256Hex(payload);
                    if (!seenHashes.Add(hash))
                        continue;

                    var baseName = PathUtil.SafeFileName(Path.GetFileName(candidate.BaseRelativePath));
                    var outputName = $"{baseName}_{hash[..12]}.{carved.Extension}";
                    var output = Path.Combine(carvedRoot, outputName);
                    File.WriteAllBytes(output, payload);
                    results.Add(new CarvedFontResult(
                        pak.PakName,
                        relative,
                        carved.Offset,
                        carved.Length,
                        outputName,
                        hash,
                        carved.Format));
                }
            }
        }

        return results;
    }

    private static int ScorePathForFont(string path, List<string> reasons)
    {
        var p = path.ToLowerInvariant();
        var score = 0;
        if (p.Contains("font")) { score += 4; reasons.Add("path contains 'font'"); }
        if (p.Contains("typeface")) { score += 4; reasons.Add("path contains 'typeface'"); }
        if (p.Contains("glyph")) { score += 2; reasons.Add("path contains 'glyph'"); }
        if (p.Contains("slate")) { score += 1; reasons.Add("path contains 'slate'"); }
        return score;
    }

    private static int ScorePathForAtlas(string path, List<string> reasons)
    {
        var p = "/" + path.ToLowerInvariant().Trim('/') + "/";
        var score = 0;
        if (p.Contains("atlas")) { score += 6; reasons.Add("path contains 'atlas'"); }
        if (p.Contains("spritesheet")) { score += 6; reasons.Add("path contains 'spritesheet'"); }
        if (p.Contains("/ui/") || p.Contains("/hud/") || p.Contains("/widget/") || p.Contains("/menu/"))
        {
            score += 3;
            reasons.Add("UI/HUD/widget/menu path");
        }
        if (p.Contains("/icon") || p.Contains("/icons/") || p.Contains("glyph"))
        {
            score += 2;
            reasons.Add("icon/glyph path");
        }
        if (p.Contains("subtitle") || p.Contains("dialog") || p.Contains("localization"))
        {
            score += 2;
            reasons.Add("subtitle/dialog/localization path");
        }
        return score;
    }

    private static int ScoreMarkers(string uasset, string uexp, string[] markers, List<string> reasons, bool fontMode)
    {
        var found = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        FindMarkers(uasset, markers, found);
        if (File.Exists(uexp))
            FindMarkers(uexp, markers, found);

        var score = 0;
        foreach (var marker in found)
        {
            reasons.Add("binary marker: " + marker);
            if (fontMode)
            {
                score += marker.Equals("FontFace", StringComparison.OrdinalIgnoreCase) ||
                         marker.Equals("CompositeFont", StringComparison.OrdinalIgnoreCase)
                    ? 6
                    : marker.Equals("SlateFontInfo", StringComparison.OrdinalIgnoreCase) || marker.Equals("Typeface", StringComparison.OrdinalIgnoreCase)
                        ? 4
                        : 2;
            }
            else
            {
                score += marker.Equals("TextureAtlas", StringComparison.OrdinalIgnoreCase) ||
                         marker.Equals("FontAtlas", StringComparison.OrdinalIgnoreCase) ||
                         marker.Equals("SpriteAtlas", StringComparison.OrdinalIgnoreCase) ||
                         marker.Equals("PaperSpriteAtlas", StringComparison.OrdinalIgnoreCase) ||
                         marker.Equals("SlateTextureAtlas", StringComparison.OrdinalIgnoreCase)
                    ? 6
                    : marker.Equals("PaperSprite", StringComparison.OrdinalIgnoreCase)
                        ? 3
                        : 1;
            }
        }
        return score;
    }

    private static void FindMarkers(string path, IEnumerable<string> markers, HashSet<string> found)
    {
        const int maxBytes = 8 * 1024 * 1024;
        using var stream = File.OpenRead(path);
        var length = (int)Math.Min(stream.Length, maxBytes);
        var data = new byte[length];
        var read = 0;
        while (read < length)
        {
            var n = stream.Read(data, read, length - read);
            if (n <= 0) break;
            read += n;
        }
        if (read != data.Length)
            Array.Resize(ref data, read);

        foreach (var marker in markers)
        {
            var ascii = Encoding.ASCII.GetBytes(marker);
            var utf16 = Encoding.Unicode.GetBytes(marker);
            if (data.AsSpan().IndexOf(ascii) >= 0 || data.AsSpan().IndexOf(utf16) >= 0)
                found.Add(marker);
        }
    }

    private static bool IsAtlasishPath(string path)
    {
        var p = path.ToLowerInvariant();
        return p.Contains("atlas") || p.Contains("spritesheet") || p.Contains("/ui/") || p.Contains("/hud/") ||
               p.Contains("/widget/") || p.Contains("/menu/") || p.Contains("icon") || p.Contains("glyph") ||
               p.Contains("subtitle") || p.Contains("dialog");
    }
}

internal static class FontCarver
{
    internal sealed record Slice(int Offset, int Length, string Extension, string Format);

    public static IEnumerable<Slice> FindFonts(byte[] data)
    {
        var found = new HashSet<(int Offset, int Length)>();
        foreach (var signature in new[]
                 {
                     new byte[] { 0x00, 0x01, 0x00, 0x00 },
                     Encoding.ASCII.GetBytes("OTTO"),
                     Encoding.ASCII.GetBytes("wOFF"),
                     Encoding.ASCII.GetBytes("wOF2"),
                 })
        {
            var start = 0;
            while (start <= data.Length - signature.Length)
            {
                var relative = data.AsSpan(start).IndexOf(signature);
                if (relative < 0)
                    break;
                var offset = start + relative;
                Slice? slice = null;

                if (signature[0] == 0x00 || signature.AsSpan().SequenceEqual(Encoding.ASCII.GetBytes("OTTO")))
                    slice = TrySfnt(data, offset);
                else
                    slice = TryWoff(data, offset);

                if (slice is not null && found.Add((slice.Offset, slice.Length)))
                    yield return slice;

                start = offset + 4;
            }
        }
    }

    private static Slice? TrySfnt(byte[] data, int offset)
    {
        if (offset < 0 || offset + 12 > data.Length)
            return null;

        var isOtf = data.AsSpan(offset, 4).SequenceEqual(Encoding.ASCII.GetBytes("OTTO"));
        var isTtf = data[offset] == 0x00 && data[offset + 1] == 0x01 && data[offset + 2] == 0x00 && data[offset + 3] == 0x00;
        if (!isOtf && !isTtf)
            return null;

        var numTables = BinaryPrimitives.ReadUInt16BigEndian(data.AsSpan(offset + 4, 2));
        if (numTables is 0 or > 256)
            return null;

        var directoryEnd = offset + 12 + numTables * 16;
        if (directoryEnd > data.Length)
            return null;

        long maxEnd = 12 + numTables * 16;
        for (var i = 0; i < numTables; i++)
        {
            var rec = offset + 12 + i * 16;
            var tableOffset = BinaryPrimitives.ReadUInt32BigEndian(data.AsSpan(rec + 8, 4));
            var tableLength = BinaryPrimitives.ReadUInt32BigEndian(data.AsSpan(rec + 12, 4));
            if (tableLength == 0)
                continue;
            var end = (long)tableOffset + tableLength;
            if (end > maxEnd)
                maxEnd = end;
        }

        maxEnd = (maxEnd + 3) & ~3L;
        if (maxEnd <= 12 || maxEnd > int.MaxValue || offset + maxEnd > data.Length)
            return null;

        return new Slice(offset, (int)maxEnd, isOtf ? "otf" : "ttf", isOtf ? "OpenType/CFF" : "TrueType");
    }

    private static Slice? TryWoff(byte[] data, int offset)
    {
        if (offset < 0 || offset + 12 > data.Length)
            return null;

        var sig = Encoding.ASCII.GetString(data, offset, 4);
        if (sig is not ("wOFF" or "wOF2"))
            return null;

        var length = BinaryPrimitives.ReadUInt32BigEndian(data.AsSpan(offset + 8, 4));
        if (length < 44 || length > int.MaxValue || offset + length > data.Length)
            return null;

        return new Slice(offset, (int)length, sig == "wOF2" ? "woff2" : "woff", sig == "wOF2" ? "WOFF2" : "WOFF");
    }
}
