import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type RunCommandResult = {
  stdout: string;
  stderr: string;
  code: number;
};

export const runCommand = async (
  command: string,
  args: string[],
  options: {
    cwd: string;
    timeoutMs?: number;
    maxBuffer?: number;
    env?: NodeJS.ProcessEnv;
  },
): Promise<RunCommandResult> => {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: options.cwd,
      timeout: options.timeoutMs ?? 30_000,
      maxBuffer: options.maxBuffer ?? 8 * 1024 * 1024,
      encoding: "utf8",
      env: {
        ...process.env,
        ...options.env,
        // Never leak secrets into subprocess env beyond what the OS already has;
        // tools should not print env. Strip common secret-looking vars from
        // being *required* — we still inherit process.env for git/rg PATH.
      },
      windowsHide: true,
    });
    return { stdout: stdout.toString(), stderr: stderr.toString(), code: 0 };
  } catch (error) {
    const err = error as {
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      code?: number | string;
      message?: string;
      killed?: boolean;
    };
    return {
      stdout: err.stdout?.toString() ?? "",
      stderr: err.stderr?.toString() ?? err.message ?? "command failed",
      code: typeof err.code === "number" ? err.code : 1,
    };
  }
};

export const truncateText = (
  text: string,
  maxChars: number,
): { text: string; truncated: boolean } => {
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }
  return {
    text: `${text.slice(0, maxChars)}\n\n… [truncated: ${text.length - maxChars} more characters]`,
    truncated: true,
  };
};

export const isIgnoredPath = (
  relativePath: string,
  ignorePatterns: string[],
): boolean => {
  const normalized = relativePath.replace(/\\/g, "/");
  return ignorePatterns.some((pattern) => {
    const clean = pattern.replace(/\\/g, "/").replace(/^\.\//, "");
    if (normalized === clean) return true;
    if (normalized.startsWith(`${clean}/`)) return true;
    // simple glob: **/name or *.ext
    if (clean.startsWith("*.")) {
      return normalized.endsWith(clean.slice(1));
    }
    return false;
  });
};

const SECRET_PATH_HINTS = [
  /^\.env(\.|$)/i,
  /\.pem$/i,
  /\.key$/i,
  /credentials/i,
  /secrets?\./i,
  /id_rsa/i,
  /\.p12$/i,
  /\.pfx$/i,
];

export const looksLikeSecretPath = (relativePath: string): boolean => {
  const base = relativePath.replace(/\\/g, "/").split("/").pop() ?? relativePath;
  return SECRET_PATH_HINTS.some((re) => re.test(base) || re.test(relativePath));
};

export const redactSecrets = (text: string): string => {
  let out = text;
  // API key-ish tokens
  out = out.replace(
    /\b(sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g,
    "[REDACTED]",
  );
  // common env assignments in dumps
  out = out.replace(
    /\b([A-Z][A-Z0-9_]*(?:API[_]?KEY|SECRET|TOKEN|PASSWORD|PRIVATE[_]?KEY))\s*[=:]\s*["']?[^\s"']+/gi,
    "$1=[REDACTED]",
  );
  return out;
};

export const guessLanguage = (filePath: string): string | undefined => {
  const ext = filePath.split(".").pop()?.toLowerCase();
  if (!ext) return undefined;
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    py: "python",
    go: "go",
    rs: "rust",
    java: "java",
    kt: "kotlin",
    rb: "ruby",
    php: "php",
    cs: "csharp",
    cpp: "cpp",
    c: "c",
    h: "c",
    md: "markdown",
    yml: "yaml",
    yaml: "yaml",
    json: "json",
    sh: "shell",
    bash: "shell",
    sql: "sql",
  };
  return map[ext];
};
