import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  ConfigSchema,
  DEFAULT_CONFIG,
  type PrReviewerConfig,
} from "./schema.js";

const CONFIG_FILENAMES = [
  ".pr-reviewer.yml",
  ".pr-reviewer.yaml",
  "pr-reviewer.yml",
  "pr-reviewer.yaml",
] as const;

export const findConfigPath = (repoRoot: string): string | null => {
  for (const name of CONFIG_FILENAMES) {
    const candidate = join(repoRoot, name);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
};

export const loadConfig = (
  repoRoot: string,
  overrides: Partial<{
    provider: string;
    model: string;
    maxIterations: number;
    severityThreshold: string;
  }> = {},
): PrReviewerConfig => {
  const path = findConfigPath(repoRoot);
  let raw: unknown = {};

  if (path) {
    const text = readFileSync(path, "utf8");
    raw = parseYaml(text) ?? {};
  }

  const fileConfig = ConfigSchema.parse(raw);

  return ConfigSchema.parse({
    ...fileConfig,
    provider: overrides.provider ?? fileConfig.provider,
    model: overrides.model ?? fileConfig.model,
    review: {
      ...fileConfig.review,
      ...(overrides.maxIterations !== undefined
        ? { maxIterations: overrides.maxIterations }
        : {}),
      ...(overrides.severityThreshold !== undefined
        ? { severityThreshold: overrides.severityThreshold }
        : {}),
    },
  });
};

export { DEFAULT_CONFIG, ConfigSchema, type PrReviewerConfig };
