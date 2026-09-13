import { describe, expect, it } from "vitest";
import { loadConfig, findConfigPath, DEFAULT_CONFIG } from "../src/config/load.js";
import { ConfigSchema } from "../src/config/schema.js";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("configuration loading", () => {
  it("returns defaults when no config file exists", () => {
    const dir = join(tmpdir(), `prnerd-config-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    try {
      expect(findConfigPath(dir)).toBeNull();
      const config = loadConfig(dir);
      expect(config.provider).toBe(DEFAULT_CONFIG.provider);
      expect(config.review.maxIterations).toBe(8);
      expect(config.paths.ignore).toContain("node_modules");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("loads yaml config and applies overrides", () => {
    const dir = join(tmpdir(), `prnerd-config-yaml-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, ".pr-reviewer.yml"),
      [
        "provider: gemini",
        "model: gemini-2.5-flash",
        "review:",
        "  maxIterations: 3",
        "  severityThreshold: high",
        "paths:",
        "  ignore:",
        "    - dist",
        "    - tmp",
      ].join("\n"),
      "utf8",
    );
    try {
      const config = loadConfig(dir, { maxIterations: 5, model: "gemini-2.0-flash" });
      expect(config.model).toBe("gemini-2.0-flash");
      expect(config.provider).toBe("gemini");
      expect(config.review.maxIterations).toBe(5);
      expect(config.review.severityThreshold).toBe("high");
      expect(config.paths.ignore).toEqual(["dist", "tmp"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects invalid severity", () => {
    expect(() =>
      ConfigSchema.parse({ review: { severityThreshold: "ultra" } }),
    ).toThrow();
  });
});
