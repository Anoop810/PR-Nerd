import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  statSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import type { PrReviewerConfig } from "../config/schema.js";
import {
  guessLanguage,
  isIgnoredPath,
  looksLikeSecretPath,
  redactSecrets,
  runCommand,
  truncateText,
} from "../utils/exec.js";
import {
  StaticPackSchema,
  type ChangedFile,
  type ChangedFileStatus,
  type StaticPack,
} from "./schema.js";

export type StaticPackBuilderOptions = {
  repoRoot: string;
  base: string;
  head: string;
  config: PrReviewerConfig;
  pr?: StaticPack["pr"];
  outputPath?: string;
};

const INSTRUCTION_FILES = ["AGENTS.md", "AGENT.md", "CLAUDE.md"] as const;

const parseNumstat = (line: string): ChangedFile | null => {
  // format: additions\tdeletions\tpath OR additions\tdeletions\told\tnew for renames
  const parts = line.split("\t");
  if (parts.length < 3) return null;
  const additions = parts[0] === "-" ? 0 : Number(parts[0]);
  const deletions = parts[1] === "-" ? 0 : Number(parts[1]);
  if (parts.length >= 4) {
    const previousPath = parts[2] ?? "";
    const path = parts[3] ?? previousPath;
    return {
      path,
      previousPath,
      status: "renamed",
      additions: Number.isFinite(additions) ? additions : 0,
      deletions: Number.isFinite(deletions) ? deletions : 0,
      language: guessLanguage(path),
    };
  }
  const path = parts[2] ?? "";
  return {
    path,
    status: "modified",
    additions: Number.isFinite(additions) ? additions : 0,
    deletions: Number.isFinite(deletions) ? deletions : 0,
    language: guessLanguage(path),
  };
};

const resolveStatus = async (
  repoRoot: string,
  base: string,
  head: string,
  files: ChangedFile[],
): Promise<ChangedFile[]> => {
  const nameStatus = await runCommand(
    "git",
    ["diff", "--name-status", "--find-renames", `${base}...${head}`],
    { cwd: repoRoot },
  );
  const statusMap = new Map<string, ChangedFileStatus>();
  for (const line of nameStatus.stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cols = line.split("\t");
    const code = cols[0]?.[0];
    if (!code) continue;
    if (code === "A") statusMap.set(cols[1] ?? "", "added");
    else if (code === "D") statusMap.set(cols[1] ?? "", "deleted");
    else if (code === "R") statusMap.set(cols[2] ?? cols[1] ?? "", "renamed");
    else statusMap.set(cols[1] ?? "", "modified");
  }
  return files.map((f) => ({
    ...f,
    status: statusMap.get(f.path) ?? f.status,
  }));
};

const extractImports = (content: string, filePath: string): string[] => {
  const imports: string[] = [];
  const patterns = [
    /import\s+(?:type\s+)?(?:[\s\S]*?)\s+from\s+["']([^"']+)["']/g,
    /require\(\s*["']([^"']+)["']\s*\)/g,
    /from\s+["']([^"']+)["']/g,
    /^\s*import\s+["']([^"']+)["']/gm,
  ];
  for (const re of patterns) {
    for (const match of content.matchAll(re)) {
      const spec = match[1];
      if (spec) imports.push(spec);
    }
  }
  // Python-ish
  if (filePath.endsWith(".py")) {
    for (const match of content.matchAll(
      /^\s*(?:from\s+(\S+)\s+import|import\s+(\S+))/gm,
    )) {
      const spec = match[1] ?? match[2];
      if (spec) imports.push(spec);
    }
  }
  return [...new Set(imports)].slice(0, 40);
};

const findRelatedTests = (
  repoRoot: string,
  changedPaths: string[],
  ignore: string[],
): string[] => {
  const related = new Set<string>();
  for (const path of changedPaths) {
    const base = path.replace(/\.[^.]+$/, "");
    const name = path.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "";
    const candidates = [
      `${base}.test.ts`,
      `${base}.test.tsx`,
      `${base}.test.js`,
      `${base}.spec.ts`,
      `${base}.spec.js`,
      `${base}_test.py`,
      `tests/${name}_test.py`,
      `test/${name}_test.go`,
      `__tests__/${name}.test.ts`,
    ];
    for (const candidate of candidates) {
      const abs = join(repoRoot, candidate);
      if (existsSync(abs) && !isIgnoredPath(candidate, ignore)) {
        related.add(candidate.replace(/\\/g, "/"));
      }
    }
  }

  // Also scan for files that mention the basename in test dirs (bounded)
  try {
    const testDirs = ["tests", "test", "__tests__", "spec"];
    for (const dir of testDirs) {
      const absDir = join(repoRoot, dir);
      if (!existsSync(absDir)) continue;
      const walk = (d: string, depth: number) => {
        if (depth > 3 || related.size >= 30) return;
        for (const entry of readdirSync(d, { withFileTypes: true })) {
          const abs = join(d, entry.name);
          const rel = relative(repoRoot, abs).replace(/\\/g, "/");
          if (isIgnoredPath(rel, ignore)) continue;
          if (entry.isDirectory()) {
            walk(abs, depth + 1);
            continue;
          }
          const lower = entry.name.toLowerCase();
          if (
            !(
              lower.includes("test") ||
              lower.includes("spec")
            )
          ) {
            continue;
          }
          for (const changed of changedPaths) {
            const stem =
              changed.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "";
            if (stem && entry.name.includes(stem)) {
              related.add(rel);
            }
          }
        }
      };
      walk(absDir, 0);
    }
  } catch {
    // ignore walk errors
  }

  return [...related].slice(0, 30);
};

const buildFileStructure = (
  repoRoot: string,
  changedFiles: string[],
  ignore: string[],
  maxEntries: number,
): { text: string; truncated: boolean } => {
  const dirs = new Set<string>();
  for (const file of changedFiles) {
    const parts = file.split("/");
    let acc = "";
    for (let i = 0; i < parts.length - 1; i++) {
      acc = acc ? `${acc}/${parts[i]}` : (parts[i] ?? "");
      dirs.add(acc);
    }
  }
  // Always include top-level listing
  dirs.add(".");

  const lines: string[] = [];
  for (const dir of [...dirs].sort()) {
    const abs = dir === "." ? repoRoot : join(repoRoot, dir);
    if (!existsSync(abs)) continue;
    let entries;
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      continue;
    }
    lines.push(dir === "." ? "." : dir);
    for (const entry of entries.slice(0, 40)) {
      const rel =
        dir === "."
          ? entry.name
          : `${dir}/${entry.name}`.replace(/\\/g, "/");
      if (isIgnoredPath(rel, ignore)) continue;
      lines.push(`  ${entry.isDirectory() ? "d" : "f"} ${entry.name}`);
      if (lines.length >= maxEntries) {
        return { text: lines.join("\n"), truncated: true };
      }
    }
  }
  return {
    text: lines.join("\n") || "(empty)",
    truncated: false,
  };
};

const loadRepositoryInstructions = (repoRoot: string): string | null => {
  for (const name of INSTRUCTION_FILES) {
    const abs = join(repoRoot, name);
    if (!existsSync(abs)) continue;
    const text = readFileSync(abs, "utf8");
    const { text: truncated } = truncateText(redactSecrets(text), 20_000);
    return truncated;
  }
  return null;
};

export class StaticPackBuilder {
  async build(options: StaticPackBuilderOptions): Promise<StaticPack> {
    const { repoRoot, base, head, config, pr } = options;
    const ignore = config.paths.ignore;

    const baseShaResult = await runCommand(
      "git",
      ["rev-parse", base],
      { cwd: repoRoot },
    );
    const headShaResult = await runCommand(
      "git",
      ["rev-parse", head],
      { cwd: repoRoot },
    );
    if (baseShaResult.code !== 0 || headShaResult.code !== 0) {
      throw new Error(
        `Failed to resolve refs. base=${base} head=${head}. Ensure you are in a git repository with those refs.`,
      );
    }
    const baseSha = baseShaResult.stdout.trim();
    const headSha = headShaResult.stdout.trim();

    const numstat = await runCommand(
      "git",
      ["diff", "--numstat", "--find-renames", `${base}...${head}`],
      { cwd: repoRoot },
    );
    if (numstat.code !== 0) {
      throw new Error(`git diff --numstat failed: ${numstat.stderr}`);
    }

    let changedFiles = numstat.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map(parseNumstat)
      .filter((f): f is ChangedFile => f !== null)
      .filter((f) => !isIgnoredPath(f.path, ignore));

    changedFiles = await resolveStatus(repoRoot, base, head, changedFiles);

    const diffResult = await runCommand(
      "git",
      ["diff", "--no-color", "--find-renames", `${base}...${head}`],
      { cwd: repoRoot, maxBuffer: 16 * 1024 * 1024 },
    );
    if (diffResult.code !== 0) {
      throw new Error(`git diff failed: ${diffResult.stderr}`);
    }
    const diffRaw = redactSecrets(diffResult.stdout);
    const diffTruncated = truncateText(
      diffRaw,
      config.staticPack.maxDiffBytes,
    );

    const commitsResult = await runCommand(
      "git",
      [
        "log",
        "--pretty=format:%H%x09%an%x09%s",
        `${base}..${head}`,
      ],
      { cwd: repoRoot },
    );
    const commits = commitsResult.stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(0, 50)
      .map((line) => {
        const [sha, author, ...rest] = line.split("\t");
        return {
          sha: sha ?? "",
          author: author ?? "",
          message: rest.join("\t"),
        };
      });

    const surroundingCode: StaticPack["surroundingCode"] = [];
    const imports: StaticPack["imports"] = [];
    const readableFiles = changedFiles
      .filter((f) => f.status !== "deleted")
      .slice(0, config.staticPack.maxSurroundingFiles);

    for (const file of readableFiles) {
      if (looksLikeSecretPath(file.path)) continue;
      const abs = join(repoRoot, file.path);
      if (!existsSync(abs)) continue;
      try {
        const st = statSync(abs);
        if (!st.isFile() || st.size > config.staticPack.maxFileBytes * 2) {
          continue;
        }
        const content = readFileSync(abs, "utf8");
        const redacted = redactSecrets(content);
        const { text, truncated } = truncateText(
          redacted,
          config.staticPack.maxFileBytes,
        );
        surroundingCode.push({
          path: file.path,
          content: text,
          truncated,
          byteLength: Buffer.byteLength(redacted, "utf8"),
        });
        imports.push({
          file: file.path,
          imports: extractImports(redacted, file.path),
        });
      } catch {
        // skip unreadable / binary
      }
    }

    const relatedTests = findRelatedTests(
      repoRoot,
      changedFiles.map((f) => f.path),
      ignore,
    );

    // Include related test file contents lightly (paths only in pack; agent can read)
    const fileStructure = buildFileStructure(
      repoRoot,
      changedFiles.map((f) => f.path),
      ignore,
      config.staticPack.maxStructureEntries,
    );

    const repoNameResult = await runCommand(
      "git",
      ["rev-parse", "--show-toplevel"],
      { cwd: repoRoot },
    );
    const topLevel = repoNameResult.stdout.trim() || repoRoot;
    const name = topLevel.split(/[/\\]/).pop();

    const pack: StaticPack = StaticPackSchema.parse({
      version: "1",
      generatedAt: new Date().toISOString(),
      repository: {
        root: repoRoot,
        name,
      },
      comparison: {
        base,
        head,
        baseSha,
        headSha,
      },
      pr,
      git: { commits },
      changedFiles,
      diff: {
        text: diffTruncated.text,
        truncated: diffTruncated.truncated,
        totalBytes: Buffer.byteLength(diffRaw, "utf8"),
      },
      surroundingCode,
      imports,
      relatedTests,
      repositoryInstructions: loadRepositoryInstructions(repoRoot),
      fileStructure,
      bounds: {
        maxDiffBytes: config.staticPack.maxDiffBytes,
        maxFileBytes: config.staticPack.maxFileBytes,
        maxStructureEntries: config.staticPack.maxStructureEntries,
      },
    });

    const outputPath =
      options.outputPath ?? join(repoRoot, ".pr-review", "static-pack.json");
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, JSON.stringify(pack, null, 2), "utf8");

    return pack;
  }
}
