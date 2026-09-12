import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCommand } from "../src/utils/exec.js";
import { StaticPackBuilder } from "../src/static-pack/builder.js";
import { DEFAULT_CONFIG } from "../src/config/schema.js";
import { StaticPackSchema } from "../src/static-pack/schema.js";

const root = join(tmpdir(), `prnerd-pack-${Date.now()}`);

beforeAll(async () => {
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "tests"), { recursive: true });
  writeFileSync(
    join(root, "src", "math.ts"),
    'import { helper } from "./helper.js";\nexport const double = (n: number) => helper(n) * 2;\n',
    "utf8",
  );
  writeFileSync(
    join(root, "src", "helper.ts"),
    "export const helper = (n: number) => n;\n",
    "utf8",
  );
  writeFileSync(
    join(root, "tests", "math.test.ts"),
    'import { double } from "../src/math.js";\n',
    "utf8",
  );
  writeFileSync(
    join(root, "AGENTS.md"),
    "# Agents\nPrefer correctness findings.\n",
    "utf8",
  );

  await runCommand("git", ["init"], { cwd: root });
  await runCommand("git", ["config", "user.email", "test@example.com"], {
    cwd: root,
  });
  await runCommand("git", ["config", "user.name", "Test"], { cwd: root });
  await runCommand("git", ["add", "."], { cwd: root });
  await runCommand("git", ["commit", "-m", "base"], { cwd: root });
  await runCommand("git", ["branch", "-M", "main"], { cwd: root });

  writeFileSync(
    join(root, "src", "math.ts"),
    'import { helper } from "./helper.js";\nexport const double = (n: number) => helper(n) * 2;\nexport const triple = (n: number) => helper(n) * 3;\n',
    "utf8",
  );
  await runCommand("git", ["add", "."], { cwd: root });
  await runCommand("git", ["commit", "-m", "add triple"], { cwd: root });
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("StaticPackBuilder", () => {
  it("builds a deterministic, schema-valid pack and writes JSON", async () => {
    const builder = new StaticPackBuilder();
    const pack = await builder.build({
      repoRoot: root,
      base: "main~1",
      head: "HEAD",
      config: DEFAULT_CONFIG,
    });

    const parsed = StaticPackSchema.parse(pack);
    expect(parsed.version).toBe("1");
    expect(parsed.changedFiles.some((f) => f.path.includes("math.ts"))).toBe(
      true,
    );
    expect(parsed.diff.text.length).toBeGreaterThan(0);
    expect(parsed.repositoryInstructions).toContain("Prefer correctness");
    expect(parsed.imports.some((i) => i.file.includes("math.ts"))).toBe(true);
    expect(parsed.relatedTests.some((t) => t.includes("math"))).toBe(true);

    const out = join(root, ".pr-review", "static-pack.json");
    expect(existsSync(out)).toBe(true);
    const disk = JSON.parse(readFileSync(out, "utf8"));
    expect(disk.comparison.headSha).toBe(parsed.comparison.headSha);
  });
});
