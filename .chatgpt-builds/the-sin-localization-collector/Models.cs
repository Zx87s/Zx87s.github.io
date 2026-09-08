namespace Zx87s.TheSinCollector;

internal sealed record CollectorOptions(
    string PaksDirectory,
    string OutputRoot,
    string? AesKey,
    bool EnableRawFallback,
    bool KeepWorkingFiles,
    bool IncludeMediumAtlasCandidates);

internal sealed record ProgressInfo(
    int Percent,
    string Stage,
    string Current,
    int Processed = 0,
    int Total = 0);

internal sealed record ProcessResult(int ExitCode, string StandardOutput, string StandardError);

internal sealed class PakContext
{
    public required string PakPath { get; init; }
    public required string PakName { get; init; }
    public required string MountPoint { get; init; }
    public required string ExtractedDirectory { get; init; }
    public List<string> Entries { get; } = new();
}

internal sealed class TextRecord
{
    public required string Id { get; init; }
    public required string Text { get; init; }
    public int Occurrences { get; set; }
    public HashSet<string> Sources { get; } = new(StringComparer.OrdinalIgnoreCase);
    public HashSet<string> Origins { get; } = new(StringComparer.OrdinalIgnoreCase);
}

internal sealed record AssetCandidate(
    string SourcePak,
    string BaseRelativePath,
    string CandidateType,
    string Confidence,
    int Score,
    string Reasons);

internal sealed record CarvedFontResult(
    string SourcePak,
    string SourceRelativePath,
    long Offset,
    int Length,
    string OutputFile,
    string Sha256,
    string Format);

internal sealed class RunSummary
{
    public string ToolVersion { get; set; } = "1.0.0";
    public DateTime StartedUtc { get; set; }
    public DateTime FinishedUtc { get; set; }
    public string PaksDirectory { get; set; } = string.Empty;
    public string RunDirectory { get; set; } = string.Empty;
    public int PakCount { get; set; }
    public int PakInventoryEntries { get; set; }
    public int ExtractedFiles { get; set; }
    public int UniqueEnglishAll { get; set; }
    public int UniqueEnglishClean { get; set; }
    public int RawTextCandidates { get; set; }
    public int FontAssetCandidates { get; set; }
    public int RawFontFiles { get; set; }
    public int CarvedFonts { get; set; }
    public int AtlasCandidates { get; set; }
    public List<string> Warnings { get; set; } = new();
}
