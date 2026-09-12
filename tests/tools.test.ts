import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCommand } from "../src/utils/exec.js";
import {
  createToolRegistry,
  resolveSafePath,
} from "../src/tools/index.js";
import type { ToolContext } from "../src/tools/types.js";

const root = join(tmpdir(), `prnerd-tools-${Date.now()}`);

beforeAll(async () => {
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "app.ts"), "export const add = (a: number, b: number) => a + b;\n", "utf8");
  writeFileSync(join(root, ".env"), "SECRET=should-not-read\n", "utf8");
  await runCommand("git", ["init"], { cwd: root });
  await runCommand("git", ["config", "user.email", "test@example.com"], {
    cwd: root,
  });
  await runCommand("git", ["config", "user.name", "Test"], { cwd: root });
  await runCommand("git", ["add", "."], { cwd: root });
  await runCommand("git", ["commit", "-m", "init"], { cwd: root });
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("tool execution", () => {
  const ctx: ToolContext = {
    repoRoot: root,
    baseRef: "HEAD",
    headRef: "HEAD",
    ignorePaths: ["node_modules", "dist"],
    maxOutputChars: 4000,
  };

  it("read_file returns numbered content", async () => {
    const tools = createToolRegistry();
    const tool = tools.get("read_file");
    const result = await tool!.execute({ path: "src/app.ts" }, ctx);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("export const add");
    expect(result.output).toMatch(/\s+1\|/);
  });

  it("read_file blocks secret-like paths", async () => {
    const tools = createToolRegistry();
    const result = await tools.get("read_file")!.execute({ path: ".env" }, ctx);
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/secret-like/i);
  });

  it("resolveSafePath blocks path escape", () => {
    const escaped = resolveSafePath(root, "../outside.ts");
    expect("error" in escaped).toBe(true);
  });

  it("list_files lists repository entries", async () => {
    const tools = createToolRegistry();
    const result = await tools.get("list_files")!.execute({ path: "src" }, ctx);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("app.ts");
  });

  it("search_code finds symbol text", async () => {
    const tools = createToolRegistry();
    const result = await tools
      .get("search_code")!
      .execute({ query: "export const add" }, ctx);
    expect(result.output.toLowerCase()).toMatch(/add|match/);
  });

  it("get_diff runs without throwing", async () => {
    const tools = createToolRegistry();
    const result = await tools.get("get_diff")!.execute({}, ctx);
    expect(result.name).toBe("get_diff");
  });
});
