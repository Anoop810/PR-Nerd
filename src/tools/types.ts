import type { ToolDefinition } from "../providers/types.js";

export type ToolContext = {
  repoRoot: string;
  baseRef: string;
  headRef: string;
  ignorePaths: string[];
  maxOutputChars: number;
};

export type ToolResult = {
  ok: boolean;
  name: string;
  output: string;
  truncated: boolean;
};

export type RepoTool = {
  definition: ToolDefinition;
  execute: (
    args: Record<string, unknown>,
    ctx: ToolContext,
  ) => Promise<ToolResult>;
};

export const TOOL_NAMES = [
  "get_diff",
  "read_file",
  "search_code",
  "list_files",
  "find_references",
  "get_file_history",
  "submit_review",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];
