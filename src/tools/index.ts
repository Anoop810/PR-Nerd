import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import {
  isIgnoredPath,
  looksLikeSecretPath,
  redactSecrets,
  runCommand,
  truncateText,
} from "../utils/exec.js";
import type { RepoTool, ToolResult } from "./types.js";
import type { ToolDefinition } from "../providers/types.js";

const bound = (
  name: string,
  text: string,
  maxChars: number,
  ok = true,
): ToolResult => {
  const redacted = redactSecrets(text);
  const { text: output, truncated } = truncateText(redacted, maxChars);
  return { ok, name, output, truncated };
};

const resolveSafePath = (
  repoRoot: string,
  relativePath: string,
): { abs: string; rel: string } | { error: string } => {
  const root = resolve(repoRoot);
  const abs = resolve(root, relativePath);
  const rel = relative(root, abs);
  if (rel.startsWith("..") || rel === "" && abs !== root) {
    return { error: `Path escapes repository root: ${relativePath}` };
  }
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  if (abs !== root && !abs.startsWith(rootWithSep)) {
    return { error: `Path escapes repository root: ${relativePath}` };
  }
  const normalizedRel = rel.replace(/\\/g, "/") || ".";
  if (looksLikeSecretPath(normalizedRel)) {
    return { error: `Refusing to read secret-like path: ${normalizedRel}` };
  }
  return { abs, rel: normalizedRel };
};

const getDiffTool: RepoTool = {
  definition: {
    name: "get_diff",
    description:
      "Return the git diff between base and head. Optionally filter to a single path.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Optional file path to scope the diff",
        },
      },
      additionalProperties: false,
    },
  },
  execute: async (args, ctx) => {
    const pathArg =
      typeof args.path === "string" && args.path.length > 0
        ? [args.path]
        : [];
    const result = await runCommand(
      "git",
      ["diff", "--no-color", `${ctx.baseRef}...${ctx.headRef}`, "--", ...pathArg],
      { cwd: ctx.repoRoot },
    );
    if (result.code !== 0) {
      return bound(
        "get_diff",
        `git diff failed: ${result.stderr || result.stdout}`,
        ctx.maxOutputChars,
        false,
      );
    }
    return bound(
      "get_diff",
      result.stdout || "(empty diff)",
      ctx.maxOutputChars,
    );
  },
};

const readFileTool: RepoTool = {
  definition: {
    name: "read_file",
    description:
      "Read a file from the working tree. Prefer files related to the PR. Secret-like paths are blocked.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Repository-relative file path" },
        startLine: {
          type: "integer",
          description: "Optional 1-based start line",
        },
        endLine: {
          type: "integer",
          description: "Optional 1-based end line (inclusive)",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  execute: async (args, ctx) => {
    if (typeof args.path !== "string") {
      return bound("read_file", "path is required", ctx.maxOutputChars, false);
    }
    const safe = resolveSafePath(ctx.repoRoot, args.path);
    if ("error" in safe) {
      return bound("read_file", safe.error, ctx.maxOutputChars, false);
    }
    if (isIgnoredPath(safe.rel, ctx.ignorePaths)) {
      return bound(
        "read_file",
        `Path is ignored by configuration: ${safe.rel}`,
        ctx.maxOutputChars,
        false,
      );
    }
    if (!existsSync(safe.abs)) {
      return bound(
        "read_file",
        `File not found: ${safe.rel}`,
        ctx.maxOutputChars,
        false,
      );
    }
    const content = readFileSync(safe.abs, "utf8");
    const lines = content.split(/\r?\n/);
    const start =
      typeof args.startLine === "number" && args.startLine > 0
        ? args.startLine
        : 1;
    const end =
      typeof args.endLine === "number" && args.endLine >= start
        ? args.endLine
        : lines.length;
    const slice = lines.slice(start - 1, end);
    const numbered = slice
      .map((line, i) => `${String(start + i).padStart(6, " ")}|${line}`)
      .join("\n");
    return bound("read_file", numbered || "(empty file)", ctx.maxOutputChars);
  },
};

const searchCodeTool: RepoTool = {
  definition: {
    name: "search_code",
    description:
      "Search repository text with ripgrep (rg) if available, otherwise a bounded recursive scan. Use to find callers, symbols, or patterns.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search pattern (regex ok)" },
        glob: {
          type: "string",
          description: "Optional glob filter, e.g. '*.ts'",
        },
        maxMatches: {
          type: "integer",
          description: "Max matches to return (default 40)",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  execute: async (args, ctx) => {
    if (typeof args.query !== "string" || !args.query.trim()) {
      return bound(
        "search_code",
        "query is required",
        ctx.maxOutputChars,
        false,
      );
    }
    const maxMatches =
      typeof args.maxMatches === "number" && args.maxMatches > 0
        ? Math.min(args.maxMatches, 100)
        : 40;
    const glob = typeof args.glob === "string" ? args.glob : undefined;

    const rgArgs = [
      "--line-number",
      "--no-heading",
      "--color",
      "never",
      "--max-count",
      String(maxMatches),
      ...ctx.ignorePaths.flatMap((p) => ["--glob", `!${p}/**`]),
      ...(glob ? ["--glob", glob] : []),
      "--",
      args.query,
      ".",
    ];

    const rg = await runCommand("rg", rgArgs, { cwd: ctx.repoRoot });
    if (rg.code === 0 || (rg.code === 1 && !rg.stderr)) {
      // rg exits 1 when no matches
      return bound(
        "search_code",
        rg.stdout || "No matches found.",
        ctx.maxOutputChars,
      );
    }

    // Fallback without rg
    const matches: string[] = [];
    const walk = (dir: string) => {
      if (matches.length >= maxMatches) return;
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (matches.length >= maxMatches) break;
        const abs = join(dir, entry.name);
        const rel = relative(ctx.repoRoot, abs).replace(/\\/g, "/");
        if (isIgnoredPath(rel, ctx.ignorePaths)) continue;
        if (entry.isDirectory()) {
          walk(abs);
          continue;
        }
        if (looksLikeSecretPath(rel)) continue;
        if (glob) {
          const ext = glob.replace("*", "");
          if (!entry.name.endsWith(ext.replace(".", "."))) {
            // naive glob: *.ts
            if (glob.startsWith("*.") && !entry.name.endsWith(glob.slice(1))) {
              continue;
            }
          }
        }
        try {
          const text = readFileSync(abs, "utf8");
          const lines = text.split(/\r?\n/);
          for (let i = 0; i < lines.length; i++) {
            if (matches.length >= maxMatches) break;
            const line = lines[i] ?? "";
            if (line.includes(args.query as string)) {
              matches.push(`${rel}:${i + 1}:${line}`);
            }
          }
        } catch {
          // binary or unreadable
        }
      }
    };
    walk(ctx.repoRoot);
    return bound(
      "search_code",
      matches.length
        ? `rg unavailable; fallback scan:\n${matches.join("\n")}`
        : "No matches found (fallback scan).",
      ctx.maxOutputChars,
    );
  },
};

const listFilesTool: RepoTool = {
  definition: {
    name: "list_files",
    description:
      "List files under a directory (bounded). Useful for understanding project layout.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Directory path relative to repo root (default '.')",
        },
        maxEntries: {
          type: "integer",
          description: "Maximum entries (default 100)",
        },
      },
      additionalProperties: false,
    },
  },
  execute: async (args, ctx) => {
    const relDir =
      typeof args.path === "string" && args.path.length > 0 ? args.path : ".";
    const maxEntries =
      typeof args.maxEntries === "number" && args.maxEntries > 0
        ? Math.min(args.maxEntries, 300)
        : 100;
    const safe = resolveSafePath(ctx.repoRoot, relDir);
    if ("error" in safe) {
      return bound("list_files", safe.error, ctx.maxOutputChars, false);
    }
    if (!existsSync(safe.abs)) {
      return bound(
        "list_files",
        `Directory not found: ${relDir}`,
        ctx.maxOutputChars,
        false,
      );
    }
    const out: string[] = [];
    const walk = (dir: string, depth: number) => {
      if (out.length >= maxEntries) return;
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (out.length >= maxEntries) break;
        const abs = join(dir, entry.name);
        const rel = relative(ctx.repoRoot, abs).replace(/\\/g, "/");
        if (isIgnoredPath(rel, ctx.ignorePaths)) continue;
        out.push(`${entry.isDirectory() ? "d" : "f"} ${rel}`);
        if (entry.isDirectory() && depth < 4) {
          walk(abs, depth + 1);
        }
      }
    };
    const st = statSync(safe.abs);
    if (!st.isDirectory()) {
      return bound(
        "list_files",
        `Not a directory: ${relDir}`,
        ctx.maxOutputChars,
        false,
      );
    }
    walk(safe.abs, 0);
    const truncated = out.length >= maxEntries;
    return bound(
      "list_files",
      `${out.join("\n")}${truncated ? "\n… [truncated]" : ""}`,
      ctx.maxOutputChars,
    );
  },
};

const findReferencesTool: RepoTool = {
  definition: {
    name: "find_references",
    description:
      "Find likely references to a symbol (function/class/const name) across the repository.",
    parameters: {
      type: "object",
      properties: {
        symbol: {
          type: "string",
          description: "Symbol name to search for",
        },
        glob: { type: "string", description: "Optional file glob" },
      },
      required: ["symbol"],
      additionalProperties: false,
    },
  },
  execute: async (args, ctx) => {
    if (typeof args.symbol !== "string" || !args.symbol.trim()) {
      return bound(
        "find_references",
        "symbol is required",
        ctx.maxOutputChars,
        false,
      );
    }
    // Escape regex metacharacters for a word-ish search
    const escaped = args.symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return searchCodeTool.execute(
      {
        query: `\\b${escaped}\\b`,
        glob: args.glob,
        maxMatches: 50,
      },
      ctx,
    ).then((r) => ({ ...r, name: "find_references" }));
  },
};

const getFileHistoryTool: RepoTool = {
  definition: {
    name: "get_file_history",
    description:
      "Show recent git commits touching a file (bounded). Optional context for regressions.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        limit: {
          type: "integer",
          description: "Number of commits (default 8, max 20)",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  execute: async (args, ctx) => {
    if (typeof args.path !== "string") {
      return bound(
        "get_file_history",
        "path is required",
        ctx.maxOutputChars,
        false,
      );
    }
    const limit =
      typeof args.limit === "number" && args.limit > 0
        ? Math.min(args.limit, 20)
        : 8;
    const result = await runCommand(
      "git",
      [
        "log",
        `--max-count=${limit}`,
        "--pretty=format:%h %ad %an %s",
        "--date=short",
        "--",
        args.path,
      ],
      { cwd: ctx.repoRoot },
    );
    if (result.code !== 0) {
      return bound(
        "get_file_history",
        `git log failed: ${result.stderr}`,
        ctx.maxOutputChars,
        false,
      );
    }
    return bound(
      "get_file_history",
      result.stdout || "No history found.",
      ctx.maxOutputChars,
    );
  },
};

/**
 * submit_review is handled specially by the agent loop (terminates investigation).
 * Still registered so the model can call it as a tool.
 */
const submitReviewTool: RepoTool = {
  definition: {
    name: "submit_review",
    description:
      "Submit the final structured review when you have enough context. Call this exactly once to finish.",
    parameters: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "Short overall review summary",
        },
        confidence: {
          type: "string",
          enum: ["high", "medium", "low"],
        },
        investigatedFiles: {
          type: "array",
          items: { type: "string" },
          description: "Files you inspected during investigation",
        },
        findings: {
          type: "array",
          description:
            "Structured findings. May be empty if no meaningful issues.",
          items: {
            type: "object",
            properties: {
              file: { type: "string" },
              line: { type: ["integer", "null"] },
              severity: {
                type: "string",
                enum: ["critical", "high", "medium", "low", "info"],
              },
              title: { type: "string" },
              explanation: { type: "string" },
              suggestion: { type: ["string", "null"] },
              category: {
                type: "string",
                enum: [
                  "bug",
                  "correctness",
                  "security",
                  "race",
                  "error_handling",
                  "edge_case",
                  "compatibility",
                  "performance",
                  "testing",
                  "other",
                ],
              },
            },
            required: [
              "file",
              "line",
              "severity",
              "title",
              "explanation",
              "suggestion",
            ],
          },
        },
      },
      required: ["summary", "confidence", "findings"],
      additionalProperties: false,
    },
  },
  execute: async () => ({
    ok: true,
    name: "submit_review",
    output: "accepted",
    truncated: false,
  }),
};

export const createToolRegistry = (): Map<string, RepoTool> => {
  const tools = [
    getDiffTool,
    readFileTool,
    searchCodeTool,
    listFilesTool,
    findReferencesTool,
    getFileHistoryTool,
    submitReviewTool,
  ];
  return new Map(tools.map((t) => [t.definition.name, t]));
};

export const getToolDefinitions = (): ToolDefinition[] =>
  [...createToolRegistry().values()].map((t) => t.definition);

export {
  getDiffTool,
  readFileTool,
  searchCodeTool,
  listFilesTool,
  findReferencesTool,
  getFileHistoryTool,
  submitReviewTool,
  resolveSafePath,
};
