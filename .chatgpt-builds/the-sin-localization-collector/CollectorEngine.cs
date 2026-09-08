using System.Text;
using System.Text.Json;

namespace Zx87s.TheSinCollector;

internal sealed class CollectorEngine
{
    private static readonly HashSet<string> StructuredExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".po", ".manifest", ".archive", ".ini", ".int", ".csv", ".json", ".txt", ".xml", ".yaml", ".yml"
    };

    private static readonly HashSet<string> BinaryTextExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".uasset", ".uexp", ".umap"
    };

    private static readonly HashSet<string> InitialExtractExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".uasset", ".uexp", ".umap", ".locres", ".po", ".manifest", ".archive", ".ini", ".int",
        ".csv", ".json", ".txt", ".xml", ".yaml", ".yml", ".ttf", ".otf", ".ttc", ".woff", ".woff2",
        ".png", ".dds", ".tga", ".jpg", ".jpeg", ".bmp", ".webp"
    };

    private readonly CollectorOptions _options;
    private readonly IProgress<ProgressInfo> _progress;
    private readonly IProgress<string> _uiLog;

    public CollectorEngine(CollectorOptions options, IProgress<ProgressInfo> progress, IProgress<string> log)
    {
        _options = options;
        _progress = progress;
        _uiLog = log;
    }

    public async Task<string> RunAsync(CancellationToken token)
    {
        var runName = "Run_" + DateTime.Now.ToString("yyyyMMdd_HHmmss");
        var runDirectory = Path.Combine(_options.OutputRoot, runName);
        var reportsDirectory = Path.Combine(runDirectory, "Reports");
        var collectedDirectory = Path.Combine(runDirectory, "Collected");
        var fontsDirectory = Path.Combine(collectedDirectory, "Fonts");
        var atlasDirectory = Path.Combine(collectedDirectory, "Atlases");
        var textSourceDirectory = Path.Combine(collectedDirectory, "TextSources");
        var workDirectory = Path.Combine(runDirectory, "Work");
        var textExtractorReports = Path.Combine(reportsDirectory, "UE4TextExtractor");

        Directory.CreateDirectory(runDirectory);
        Directory.CreateDirectory(reportsDirectory);
        Directory.CreateDirectory(collectedDirectory);
        Directory.CreateDirectory(workDirectory);
        Directory.CreateDirectory(textExtractorReports);

        using var log = new LogWriter(Path.Combine(runDirectory, "Collector.log"), _uiLog);
        var summary = new RunSummary
        {
            StartedUtc = DateTime.UtcNow,
            PaksDirectory = Path.GetFullPath(_options.PaksDirectory),
            RunDirectory = Path.GetFullPath(runDirectory),
        };

        try
        {
            Report(1, "Preparing", "Loading embedded helper tools");
            var repak = ToolBootstrap.PrepareTool("repak.exe", "repak.exe");
            var ue4TextExtractor = ToolBootstrap.PrepareTool("UE4TextExtractor.exe", "UE4TextExtractor.exe");
            ToolBootstrap.ExportTextResource("THIRD_PARTY_NOTICES.txt", Path.Combine(runDirectory, "THIRD_PARTY_NOTICES.txt"));

            log.Info("Zx87s TheSin Localization Collector v1.0.0");
            log.Info("Read-only source mode: original game PAK files will never be modified.");
            log.Info($"PAKs directory: {_options.PaksDirectory}");
            log.Info($"Output directory: {runDirectory}");

            var pakFiles = Directory.GetFiles(_options.PaksDirectory, "*.pak", SearchOption.TopDirectoryOnly)
                .OrderBy(x => Path.GetFileName(x), StringComparer.OrdinalIgnoreCase)
                .ToList();
            if (pakFiles.Count == 0)
                throw new InvalidOperationException("No .pak files were found in the selected directory.");

            summary.PakCount = pakFiles.Count;
            CheckDiskSpace(pakFiles, runDirectory, summary, log);

            var contexts = new List<PakContext>(pakFiles.Count);
            var inventoryRows = new List<IReadOnlyList<string?>>()
            {
                new string?[] { "SourcePak", "EntryPath", "Extension", "InitialExtractionCategory" }
            };

            Report(4, "Indexing PAKs", "Reading mount points and file inventories", 0, pakFiles.Count);
            for (var i = 0; i < pakFiles.Count; i++)
            {
                token.ThrowIfCancellationRequested();
                var pak = pakFiles[i];
                var pakName = Path.GetFileName(pak);
                Report(4 + (int)(10.0 * i / Math.Max(1, pakFiles.Count)), "Indexing PAKs", pakName, i, pakFiles.Count);
                log.Info($"Indexing {pakName}");

                var mountPoint = await ReadMountPointAsync(repak, pak, log, token);
                var entries = await ReadPakEntriesAsync(repak, pak, log, token);
                if (entries.Count == 0)
                    log.Warn($"{pakName}: PAK inventory is empty. The archive may be encrypted, malformed, or unsupported.");

                var extracted = Path.Combine(workDirectory, "Extracted", PathUtil.SafeFileName(Path.GetFileNameWithoutExtension(pakName)));
                var context = new PakContext
                {
                    PakPath = pak,
                    PakName = pakName,
                    MountPoint = mountPoint,
                    ExtractedDirectory = extracted,
                };
                context.Entries.AddRange(entries);
                contexts.Add(context);

                foreach (var entry in entries)
                {
                    inventoryRows.Add(new string?[]
                    {
                        pakName,
                        entry,
                        Path.GetExtension(entry),
                        InitialCategory(entry)
                    });
                }
            }

            summary.PakInventoryEntries = contexts.Sum(c => c.Entries.Count);
            CsvUtil.WriteRows(Path.Combine(reportsDirectory, "Pak_Inventory.csv"), inventoryRows);

            var totalInitial = contexts.Sum(c => c.Entries.Count(ShouldInitialExtract));
            var extractedCounter = 0;
            Report(15, "Selective extraction", "Extracting localization-relevant files", extractedCounter, totalInitial);

            foreach (var context in contexts)
            {
                token.ThrowIfCancellationRequested();
                var wantedCount = context.Entries.Count(ShouldInitialExtract);
                if (wantedCount == 0)
                {
                    log.Info($"{context.PakName}: no initially-selected files.");
                    continue;
                }

                Directory.CreateDirectory(context.ExtractedDirectory);
                log.Info($"{context.PakName}: selectively extracting approximately {wantedCount:N0} localization-relevant files.");

                var before = CountFiles(context.ExtractedDirectory);
                await UnpackWithPatternsAsync(
                    repak,
                    context,
                    InitialIncludePatterns(),
                    context.ExtractedDirectory,
                    "Selective extraction",
                    15,
                    42,
                    extractedCounter,
                    totalInitial,
                    token,
                    log);
                var after = CountFiles(context.ExtractedDirectory);
                extractedCounter += Math.Max(0, after - before);
                Report(15 + (int)(27.0 * Math.Min(extractedCounter, Math.Max(1, totalInitial)) / Math.Max(1, totalInitial)),
                    "Selective extraction", context.PakName, extractedCounter, totalInitial);
            }

            summary.ExtractedFiles = contexts.Sum(c => CountFiles(c.ExtractedDirectory));
            CopyOriginalTextSources(contexts, textSourceDirectory, log);

            var textCollector = new TextCollector();
            var textScanFiles = contexts
                .Where(c => Directory.Exists(c.ExtractedDirectory))
                .SelectMany(c => Directory.EnumerateFiles(c.ExtractedDirectory, "*", SearchOption.AllDirectories)
                    .Select(path => (Context: c, Path: path)))
                .Where(x => StructuredExtensions.Contains(Path.GetExtension(x.Path)) ||
                            BinaryTextExtensions.Contains(Path.GetExtension(x.Path)) ||
                            Path.GetExtension(x.Path).Equals(".locres", StringComparison.OrdinalIgnoreCase))
                .ToList();

            var textProcessed = 0;
            Report(43, "Extracting text", "UE localizable text and structured resources", textProcessed, textScanFiles.Count);

            foreach (var context in contexts)
            {
                token.ThrowIfCancellationRequested();
                if (!Directory.Exists(context.ExtractedDirectory))
                    continue;

                var extractorOutput = Path.Combine(textExtractorReports, PathUtil.SafeFileName(Path.GetFileNameWithoutExtension(context.PakName)) + "_assets.txt");
                var extractorResult = await ProcessRunner.RunAsync(
                    ue4TextExtractor,
                    new[] { context.ExtractedDirectory, extractorOutput, "-all-uexps", "-src" },
                    line =>
                    {
                        if (line.Contains("Error", StringComparison.OrdinalIgnoreCase))
                            log.Warn($"UE4TextExtractor: {line}");
                    },
                    line =>
                    {
                        if (!string.IsNullOrWhiteSpace(line))
                            log.Warn($"UE4TextExtractor: {line}");
                    },
                    token);

                if (extractorResult.ExitCode == 0 && File.Exists(extractorOutput))
                {
                    textCollector.AddUe4ExtractorFile(extractorOutput, context.PakName);
                }
                else
                {
                    var message = $"{context.PakName}: UE4TextExtractor returned exit code {extractorResult.ExitCode}; fallback scans will still run.";
                    summary.Warnings.Add(message);
                    log.Warn(message);
                }

                foreach (var locres in Directory.EnumerateFiles(context.ExtractedDirectory, "*.locres", SearchOption.AllDirectories))
                {
                    token.ThrowIfCancellationRequested();
                    var relative = PathUtil.ToSlash(Path.GetRelativePath(context.ExtractedDirectory, locres));
                    var locresOutput = Path.Combine(
                        textExtractorReports,
                        PathUtil.SafeFileName(Path.GetFileNameWithoutExtension(context.PakName)),
                        relative.Replace('/', Path.DirectorySeparatorChar) + ".txt");
                    Directory.CreateDirectory(Path.GetDirectoryName(locresOutput)!);

                    var result = await ProcessRunner.RunAsync(
                        ue4TextExtractor,
                        new[] { locres, locresOutput },
                        null,
                        line => { if (!string.IsNullOrWhiteSpace(line)) log.Warn($"LOCRES {relative}: {line}"); },
                        token);

                    if (result.ExitCode == 0 && File.Exists(locresOutput))
                        textCollector.AddUe4ExtractorFile(locresOutput, context.PakName + " | " + relative);
                    else
                        log.Warn($"{context.PakName}: could not convert LOCRES '{relative}' (exit {result.ExitCode}).");
                }
            }

            foreach (var item in textScanFiles)
            {
                token.ThrowIfCancellationRequested();
                var ext = Path.GetExtension(item.Path);
                var relative = PathUtil.ToSlash(Path.GetRelativePath(item.Context.ExtractedDirectory, item.Path));
                var source = item.Context.PakName + " | " + relative;

                if (StructuredExtensions.Contains(ext))
                    textCollector.AddStructuredFile(item.Path, source, log);

                textProcessed++;
                Report(50 + (int)(10.0 * textProcessed / Math.Max(1, textScanFiles.Count)), "Extracting text", relative, textProcessed, textScanFiles.Count);
            }

            if (_options.EnableRawFallback)
            {
                var rawCandidates = textScanFiles.Where(x => BinaryTextExtensions.Contains(Path.GetExtension(x.Path))).ToList();
                for (var i = 0; i < rawCandidates.Count; i++)
                {
                    token.ThrowIfCancellationRequested();
                    var item = rawCandidates[i];
                    var relative = PathUtil.ToSlash(Path.GetRelativePath(item.Context.ExtractedDirectory, item.Path));
                    textCollector.AddRawBinaryFile(item.Path, item.Context.PakName + " | " + relative, token);
                    Report(60 + (int)(10.0 * (i + 1) / Math.Max(1, rawCandidates.Count)),
                        "Deep text fallback", relative, i + 1, rawCandidates.Count);
                }
            }

            var allCandidates = new List<AssetCandidate>();
            Report(71, "Analyzing assets", "Classifying fonts and atlas/UI assets", 0, contexts.Count);
            for (var i = 0; i < contexts.Count; i++)
            {
                token.ThrowIfCancellationRequested();
                var context = contexts[i];
                allCandidates.AddRange(AssetAnalyzer.AnalyzeCookedAssets(context, log));
                Report(71 + (int)(7.0 * (i + 1) / Math.Max(1, contexts.Count)), "Analyzing assets", context.PakName, i + 1, contexts.Count);
            }

            // Candidate assets may keep bulk payloads in .ubulk/.uptnl files. Extract only exact companions discovered from the PAK inventory.
            for (var i = 0; i < contexts.Count; i++)
            {
                token.ThrowIfCancellationRequested();
                var context = contexts[i];
                var candidates = allCandidates.Where(c => c.SourcePak.Equals(context.PakName, StringComparison.OrdinalIgnoreCase)).ToList();
                var companions = AssetAnalyzer.FindCompanionBulkEntries(context, candidates);
                if (companions.Count == 0)
                    continue;

                log.Info($"{context.PakName}: extracting {companions.Count:N0} exact bulk companion files for font/atlas candidates.");
                foreach (var batch in companions.Chunk(80))
                {
                    await UnpackWithPatternsAsync(
                        repak,
                        context,
                        batch,
                        context.ExtractedDirectory,
                        "Extracting bulk companions",
                        78,
                        83,
                        0,
                        companions.Count,
                        token,
                        log);
                }
                Report(78 + (int)(5.0 * (i + 1) / Math.Max(1, contexts.Count)), "Extracting bulk companions", context.PakName, i + 1, contexts.Count);
            }

            var carvedFonts = new List<CarvedFontResult>();
            var rawFonts = 0;
            var rawAtlasImages = 0;
            Report(84, "Collecting assets", "Copying fonts, atlas candidates and companion payloads", 0, contexts.Count);
            for (var i = 0; i < contexts.Count; i++)
            {
                token.ThrowIfCancellationRequested();
                var context = contexts[i];
                var candidates = allCandidates.Where(c => c.SourcePak.Equals(context.PakName, StringComparison.OrdinalIgnoreCase)).ToList();
                rawFonts += AssetAnalyzer.CopyRawFonts(context, fontsDirectory);
                rawAtlasImages += AssetAnalyzer.CopyRawAtlasImages(context, atlasDirectory);
                AssetAnalyzer.CopyCookedCandidates(context, candidates, fontsDirectory, atlasDirectory, _options.IncludeMediumAtlasCandidates);
                carvedFonts.AddRange(AssetAnalyzer.CarveEmbeddedFonts(context, candidates, fontsDirectory, token, log));
                Report(84 + (int)(7.0 * (i + 1) / Math.Max(1, contexts.Count)), "Collecting assets", context.PakName, i + 1, contexts.Count);
            }

            Report(92, "Writing reports", "Exporting unique English text and manifests");
            var textStats = textCollector.Export(reportsDirectory);
            WriteAssetReports(reportsDirectory, allCandidates, carvedFonts);

            summary.UniqueEnglishAll = textStats.All;
            summary.UniqueEnglishClean = textStats.Clean;
            summary.RawTextCandidates = textStats.Raw;
            summary.FontAssetCandidates = allCandidates.Count(c => c.CandidateType == "FontAsset");
            summary.RawFontFiles = rawFonts;
            summary.CarvedFonts = carvedFonts.Count;
            summary.AtlasCandidates = allCandidates.Count(c => c.CandidateType == "AtlasAsset") + rawAtlasImages;
            summary.FinishedUtc = DateTime.UtcNow;

            WriteOutputGuide(runDirectory, summary, rawAtlasImages);
            await WriteSummaryAsync(Path.Combine(reportsDirectory, "Summary.json"), summary, token);

            if (!_options.KeepWorkingFiles)
            {
                Report(97, "Cleaning up", "Removing temporary extracted working files");
                TryDeleteDirectory(workDirectory, log);
            }
            else
            {
                log.Info("Temporary working files were kept because the option is enabled.");
            }

            Report(100, "Completed", "Reports and collected assets are ready");
            log.Info($"Completed. Unique clean English text: {summary.UniqueEnglishClean:N0}; font candidates: {summary.FontAssetCandidates:N0}; carved fonts: {summary.CarvedFonts:N0}; atlas candidates: {summary.AtlasCandidates:N0}.");
            return runDirectory;
        }
        catch (OperationCanceledException)
        {
            summary.FinishedUtc = DateTime.UtcNow;
            File.WriteAllText(Path.Combine(runDirectory, "CANCELLED.txt"),
                "This collection run was cancelled. Original game files were not modified. Partial reports/work files may remain.",
                new UTF8Encoding(true));
            log.Warn("Run cancelled by user.");
            throw;
        }
        catch (Exception ex)
        {
            summary.FinishedUtc = DateTime.UtcNow;
            try
            {
                File.WriteAllText(Path.Combine(runDirectory, "FAILED.txt"), ex.ToString(), new UTF8Encoding(true));
                await WriteSummaryAsync(Path.Combine(reportsDirectory, "Summary.json"), summary, CancellationToken.None);
            }
            catch { }
            log.Error(ex.ToString());
            throw;
        }
    }

    private async Task<string> ReadMountPointAsync(string repak, string pak, LogWriter log, CancellationToken token)
    {
        var args = BuildRepakArgs("info", pak);
        var result = await ProcessRunner.RunAsync(repak, args, null, null, token);
        EnsureRepakSuccess(result, pak, "read PAK information");

        foreach (var line in result.StandardOutput.Replace("\r", string.Empty).Split('\n'))
        {
            var trimmed = line.Trim();
            if (!trimmed.StartsWith("mount point:", StringComparison.OrdinalIgnoreCase))
                continue;
            var mount = trimmed[(trimmed.IndexOf(':') + 1)..].Trim().Replace('\\', '/').Trim('/');
            log.Info($"{Path.GetFileName(pak)}: mount point '{mount}'.");
            return mount;
        }

        log.Warn($"{Path.GetFileName(pak)}: mount point was not reported; continuing without prefix stripping.");
        return string.Empty;
    }

    private async Task<List<string>> ReadPakEntriesAsync(string repak, string pak, LogWriter log, CancellationToken token)
    {
        var result = await ProcessRunner.RunAsync(repak, BuildRepakArgs("list", pak), null, null, token);
        EnsureRepakSuccess(result, pak, "list PAK contents");

        var raw = result.StandardOutput.Replace("\r", string.Empty)
            .Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(line => !line.StartsWith("version:", StringComparison.OrdinalIgnoreCase))
            .Where(line => !line.StartsWith("mount point:", StringComparison.OrdinalIgnoreCase))
            .Select(line => line.Replace('\\', '/').TrimStart('/'))
            .Where(line => line.Length > 0)
            .ToList();

        var mount = await ReadMountPointAsync(repak, pak, log, token);
        if (!string.IsNullOrWhiteSpace(mount))
        {
            var prefix = mount.Trim('/') + "/";
            raw = raw.Select(entry => entry.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) ? entry[prefix.Length..] : entry).ToList();
        }

        return raw.Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(x => x, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private IEnumerable<string> BuildRepakArgs(string command, string pak, IEnumerable<string>? commandArguments = null)
    {
        if (!string.IsNullOrWhiteSpace(_options.AesKey))
        {
            yield return "--aes-key";
            yield return _options.AesKey!;
        }

        yield return command;
        if (commandArguments is not null)
        {
            foreach (var arg in commandArguments)
                yield return arg;
        }
        yield return pak;
    }

    private async Task UnpackWithPatternsAsync(
        string repak,
        PakContext context,
        IEnumerable<string> patterns,
        string outputDirectory,
        string stage,
        int startPercent,
        int endPercent,
        int processedOffset,
        int total,
        CancellationToken token,
        LogWriter log)
    {
        Directory.CreateDirectory(outputDirectory);
        var commandArgs = new List<string>
        {
            "-o", outputDirectory,
            "-f",
            "-q",
            "-v"
        };

        if (!string.IsNullOrWhiteSpace(context.MountPoint))
        {
            commandArgs.Add("-s");
            commandArgs.Add(context.MountPoint);
        }

        foreach (var pattern in patterns.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            commandArgs.Add("-i");
            commandArgs.Add(pattern);
        }

        var localProcessed = 0;
        var result = await ProcessRunner.RunAsync(
            repak,
            BuildRepakArgs("unpack", context.PakPath, commandArgs),
            line =>
            {
                if (line.Contains("unpacking", StringComparison.OrdinalIgnoreCase))
                {
                    localProcessed++;
                    var combined = processedOffset + localProcessed;
                    var pct = startPercent + (int)((endPercent - startPercent) * Math.Min(combined, Math.Max(1, total)) / (double)Math.Max(1, total));
                    var current = ExtractRepakCurrentPath(line);
                    Report(pct, stage, string.IsNullOrWhiteSpace(current) ? context.PakName : current, combined, total);
                }
            },
            line =>
            {
                if (!string.IsNullOrWhiteSpace(line))
                    log.Warn($"repak {context.PakName}: {line}");
            },
            token);

        EnsureRepakSuccess(result, context.PakPath, "extract selected PAK files");
    }

    private static string ExtractRepakCurrentPath(string line)
    {
        var idx = line.IndexOf("unpacking", StringComparison.OrdinalIgnoreCase);
        if (idx < 0)
            return string.Empty;
        return line[(idx + "unpacking".Length)..].Trim().Trim('"', '\'');
    }

    private void EnsureRepakSuccess(ProcessResult result, string pak, string operation)
    {
        if (result.ExitCode == 0)
            return;

        var combined = (result.StandardError + "\n" + result.StandardOutput).Trim();
        var encrypted = combined.Contains("aes", StringComparison.OrdinalIgnoreCase) ||
                        combined.Contains("encrypt", StringComparison.OrdinalIgnoreCase) ||
                        combined.Contains("key", StringComparison.OrdinalIgnoreCase);

        var hint = encrypted && string.IsNullOrWhiteSpace(_options.AesKey)
            ? " The archive appears to require an AES key; enter the game's AES key in the optional AES field."
            : string.Empty;

        var detail = combined.Length > 1_200 ? combined[..1_200] + "..." : combined;
        throw new InvalidOperationException(
            $"repak could not {operation} for '{Path.GetFileName(pak)}' (exit {result.ExitCode}).{hint}\n\n{detail}");
    }

    private static IEnumerable<string> InitialIncludePatterns()
    {
        foreach (var ext in InitialExtractExtensions.OrderBy(x => x, StringComparer.OrdinalIgnoreCase))
        {
            yield return "**/*" + ext.ToLowerInvariant();
            yield return "**/*" + ext.ToUpperInvariant();
        }
        yield return "**/AssetRegistry.bin";
        yield return "**/assetregistry.bin";
    }

    private static bool ShouldInitialExtract(string entry)
    {
        var ext = Path.GetExtension(entry);
        if (InitialExtractExtensions.Contains(ext))
            return true;
        return Path.GetFileName(entry).Equals("AssetRegistry.bin", StringComparison.OrdinalIgnoreCase);
    }

    private static string InitialCategory(string entry)
    {
        var ext = Path.GetExtension(entry);
        if (ext.Equals(".locres", StringComparison.OrdinalIgnoreCase)) return "LOCRES";
        if (StructuredExtensions.Contains(ext)) return "StructuredText";
        if (BinaryTextExtensions.Contains(ext)) return "CookedUEAsset";
        if (new[] { ".ttf", ".otf", ".ttc", ".woff", ".woff2" }.Contains(ext, StringComparer.OrdinalIgnoreCase)) return "RawFont";
        if (new[] { ".png", ".dds", ".tga", ".jpg", ".jpeg", ".bmp", ".webp" }.Contains(ext, StringComparer.OrdinalIgnoreCase)) return "RawImage";
        if (Path.GetFileName(entry).Equals("AssetRegistry.bin", StringComparison.OrdinalIgnoreCase)) return "AssetRegistry";
        return "NotSelected";
    }

    private static void CopyOriginalTextSources(IEnumerable<PakContext> contexts, string destinationRoot, LogWriter log)
    {
        var copied = 0;
        foreach (var context in contexts)
        {
            if (!Directory.Exists(context.ExtractedDirectory))
                continue;
            var safePak = PathUtil.SafeFileName(Path.GetFileNameWithoutExtension(context.PakName));
            var targetRoot = Path.Combine(destinationRoot, safePak);
            foreach (var path in Directory.EnumerateFiles(context.ExtractedDirectory, "*", SearchOption.AllDirectories))
            {
                var ext = Path.GetExtension(path);
                if (!StructuredExtensions.Contains(ext) && !ext.Equals(".locres", StringComparison.OrdinalIgnoreCase))
                    continue;
                FileCopyUtil.CopyPreserveRelative(context.ExtractedDirectory, path, targetRoot);
                copied++;
            }
        }
        log.Info($"Preserved {copied:N0} original localization/structured text source files in Collected\\TextSources.");
    }

    private static void WriteAssetReports(string reportsDirectory, IReadOnlyList<AssetCandidate> candidates, IReadOnlyList<CarvedFontResult> carvedFonts)
    {
        CsvUtil.WriteRows(
            Path.Combine(reportsDirectory, "Font_Asset_Candidates.csv"),
            CandidateRows(candidates.Where(c => c.CandidateType == "FontAsset")));
        CsvUtil.WriteRows(
            Path.Combine(reportsDirectory, "Atlas_Asset_Candidates.csv"),
            CandidateRows(candidates.Where(c => c.CandidateType == "AtlasAsset")));

        IEnumerable<IReadOnlyList<string?>> carvedRows()
        {
            yield return new string?[] { "SourcePak", "SourceRelativePath", "Offset", "Length", "OutputFile", "SHA256", "Format" };
            foreach (var item in carvedFonts.OrderBy(x => x.SourcePak, StringComparer.OrdinalIgnoreCase).ThenBy(x => x.SourceRelativePath, StringComparer.OrdinalIgnoreCase))
            {
                yield return new string?[]
                {
                    item.SourcePak,
                    item.SourceRelativePath,
                    item.Offset.ToString(),
                    item.Length.ToString(),
                    item.OutputFile,
                    item.Sha256,
                    item.Format
                };
            }
        }
        CsvUtil.WriteRows(Path.Combine(reportsDirectory, "Carved_Fonts.csv"), carvedRows());
    }

    private static IEnumerable<IReadOnlyList<string?>> CandidateRows(IEnumerable<AssetCandidate> source)
    {
        yield return new string?[] { "SourcePak", "BaseRelativePath", "CandidateType", "Confidence", "Score", "Reasons" };
        foreach (var item in source
                     .OrderByDescending(x => x.Score)
                     .ThenBy(x => x.SourcePak, StringComparer.OrdinalIgnoreCase)
                     .ThenBy(x => x.BaseRelativePath, StringComparer.OrdinalIgnoreCase))
        {
            yield return new string?[]
            {
                item.SourcePak, item.BaseRelativePath, item.CandidateType, item.Confidence, item.Score.ToString(), item.Reasons
            };
        }
    }

    private static void WriteOutputGuide(string runDirectory, RunSummary summary, int rawAtlasImages)
    {
        var text = $"""
Zx87s - TheSin Localization Collector
=====================================

This output is READ-ONLY analysis. No original game PAK file was modified.

Key reports
-----------
Reports\English_Unique_Clean.csv
    Recommended translation source list. Exact duplicate source strings are merged.

Reports\Translation_Worksheet_AR.csv
    Arabic localization worksheet. Keep EnglishSource unchanged and enter Arabic in ArabicTranslation.
    Rows marked DoNotTranslate=YES are dynamic keyboard/mouse/gamepad input names and should remain unchanged.

Reports\English_Unique_All.csv
    Complete English candidates, including technical/internal strings for audit coverage.

Reports\English_Raw_Candidates.csv
    Deep heuristic ASCII/UTF-16 fallback candidates. Review manually before translating.

Reports\Font_Asset_Candidates.csv
    Cooked Unreal font/font-face candidates with confidence score and detection reasons.

Reports\Carved_Fonts.csv
    Valid embedded TrueType/OpenType/WOFF fonts carved from cooked font assets, when detectable.

Reports\Atlas_Asset_Candidates.csv
    UI/atlas/sprite candidates with confidence score and detection reasons.

Reports\Pak_Inventory.csv
    PAK-level source inventory for traceability.

Collected\TextSources
    Preserved extracted LOCRES / PO / manifest / archive / INI / CSV / JSON / XML / text sources.

Collected\Fonts
    Raw font files, cooked font assets and carved embedded font payloads.

Collected\Atlases
    Raw atlas-like images and cooked UI/atlas candidates with their companion payloads.

Run totals
----------
PAK files: {summary.PakCount:N0}
PAK inventory entries: {summary.PakInventoryEntries:N0}
Unique English candidates (all): {summary.UniqueEnglishAll:N0}
Recommended clean English strings: {summary.UniqueEnglishClean:N0}
Raw fallback text candidates: {summary.RawTextCandidates:N0}
Cooked font asset candidates: {summary.FontAssetCandidates:N0}
Raw font files copied: {summary.RawFontFiles:N0}
Embedded fonts carved: {summary.CarvedFonts:N0}
Atlas/UI candidates: {summary.AtlasCandidates:N0}
Raw atlas-like images copied: {rawAtlasImages:N0}

Important localization rule
---------------------------
Do not manually reverse Arabic characters or lines. Final game integration must preserve logical Unicode Arabic,
apply shaping/bidi exactly once, and render long text top-to-bottom with right-to-left reading order.
""";
        File.WriteAllText(Path.Combine(runDirectory, "READ_ME_FIRST.txt"), text, new UTF8Encoding(true));
    }

    private static async Task WriteSummaryAsync(string path, RunSummary summary, CancellationToken token)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        await using var stream = new FileStream(path, FileMode.Create, FileAccess.Write, FileShare.Read, 64 * 1024, FileOptions.Asynchronous);
        await JsonSerializer.SerializeAsync(stream, summary, new JsonSerializerOptions { WriteIndented = true }, token);
    }

    private static void CheckDiskSpace(IReadOnlyCollection<string> pakFiles, string runDirectory, RunSummary summary, LogWriter log)
    {
        try
        {
            var root = Path.GetPathRoot(Path.GetFullPath(runDirectory));
            if (string.IsNullOrWhiteSpace(root))
                return;
            var drive = new DriveInfo(root);
            var totalPakBytes = pakFiles.Sum(p => new FileInfo(p).Length);
            var recommended = Math.Min(totalPakBytes, 40L * 1024 * 1024 * 1024);
            if (drive.AvailableFreeSpace < Math.Max(2L * 1024 * 1024 * 1024, recommended / 8))
            {
                var warning = $"Low free disk space on {drive.Name}: {drive.AvailableFreeSpace / 1024d / 1024d / 1024d:F1} GiB available. Selective extraction may require additional space.";
                summary.Warnings.Add(warning);
                log.Warn(warning);
            }
        }
        catch (Exception ex)
        {
            log.Warn("Unable to check free disk space: " + ex.Message);
        }
    }

    private static int CountFiles(string directory)
    {
        if (!Directory.Exists(directory))
            return 0;
        try { return Directory.EnumerateFiles(directory, "*", SearchOption.AllDirectories).Count(); }
        catch { return 0; }
    }

    private static void TryDeleteDirectory(string directory, LogWriter log)
    {
        if (!Directory.Exists(directory))
            return;
        try
        {
            Directory.Delete(directory, recursive: true);
        }
        catch (Exception ex)
        {
            log.Warn("Could not remove the temporary Work directory: " + ex.Message);
        }
    }

    private void Report(int percent, string stage, string current, int processed = 0, int total = 0)
        => _progress.Report(new ProgressInfo(Math.Clamp(percent, 0, 100), stage, current, processed, total));
}
