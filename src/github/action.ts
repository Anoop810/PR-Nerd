#!/usr/bin/env node
/**
 * GitHub Action entrypoint.
 * Expects a checked-out repo and GitHub event context via env.
 */
import { resolve } from "node:path";
import { loadConfig } from "../config/load.js";
import { createProvider } from "../providers/index.js";
import { ReviewEngine } from "../review/engine.js";
import {
  formatReviewMarkdown,
  publishPullRequestComment,
} from "./publish.js";
import type { AgentEvent } from "../agent/loop.js";

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

const main = async (): Promise<void> => {
  const workspace = resolve(process.env.GITHUB_WORKSPACE || process.cwd());
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

  const eventName = process.env.GITHUB_EVENT_NAME ?? "";
  const base =
    process.env.PRNERD_BASE ||
    process.env.GITHUB_BASE_REF ||
    "main";
  const head =
    process.env.PRNERD_HEAD ||
    process.env.GITHUB_HEAD_REF ||
    "HEAD";

  // Prefer SHAs when available (Actions checkout)
  const baseSha = process.env.PRNERD_BASE_SHA;
  const headSha = process.env.PRNERD_HEAD_SHA;

  const config = loadConfig(workspace, {
    provider: process.env.PRNERD_PROVIDER,
    model: process.env.PRNERD_MODEL,
    maxIterations: process.env.PRNERD_MAX_ITERATIONS
      ? Number(process.env.PRNERD_MAX_ITERATIONS)
      : undefined,
    severityThreshold: process.env.PRNERD_SEVERITY_THRESHOLD,
  });

  const explicitKey =
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    process.env.PRNERD_GEMINI_API_KEY;

  let provider;
  try {
    const maxRetries = process.env.PRNERD_GEMINI_MAX_RETRIES
      ? Number(process.env.PRNERD_GEMINI_MAX_RETRIES)
      : undefined;
    const retryBaseMs = process.env.PRNERD_GEMINI_RETRY_BASE_MS
      ? Number(process.env.PRNERD_GEMINI_RETRY_BASE_MS)
      : undefined;
    provider = createProvider(config.provider, {
      ...(explicitKey ? { apiKey: explicitKey } : {}),
      ...(Number.isFinite(maxRetries) ? { maxRetries } : {}),
      ...(Number.isFinite(retryBaseMs) ? { retryBaseMs } : {}),
      fallbackModels: config.fallbackModels,
    });
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? error.message
        : "BYOK: set GEMINI_API_KEY secret for Gemini reviews",
    );
  }
  const engine = new ReviewEngine();

  const result = await engine.run({
    repoRoot: workspace,
    base: baseSha || base,
    head: headSha || head,
    config,
    provider,
    pr: {
      number: process.env.PRNERD_PR_NUMBER
        ? Number(process.env.PRNERD_PR_NUMBER)
        : undefined,
      title: process.env.PRNERD_PR_TITLE,
      body: process.env.PRNERD_PR_BODY,
      author: process.env.PRNERD_PR_AUTHOR,
      url: process.env.PRNERD_PR_URL,
    },
    onEvent: (event: AgentEvent) => {
      if (event.type === "iteration") {
        console.log(`iteration ${event.iteration}`);
      } else if (event.type === "tool_call") {
        console.log(`tool ${event.name}`);
      } else if (event.type === "completed") {
        console.log(`findings ${event.result.findings.length}`);
      }
    },
  });

  if (!result.review) {
    throw new Error("Review engine returned no review");
  }

  const body = formatReviewMarkdown(result.review);
  console.log(body);

  const shouldPublish =
    process.env.PRNERD_PUBLISH !== "false" &&
    Boolean(token) &&
    Boolean(process.env.PRNERD_PR_NUMBER || process.env.GITHUB_EVENT_PATH);

  if (!shouldPublish) {
    console.log("Skipping GitHub publish (no token/PR number or PRNERD_PUBLISH=false)");
    return;
  }

  if (!token) {
    throw new Error("GITHUB_TOKEN required to publish review comments");
  }

  let pullNumber = process.env.PRNERD_PR_NUMBER
    ? Number(process.env.PRNERD_PR_NUMBER)
    : undefined;
  let repository =
    process.env.PRNERD_REPOSITORY || process.env.GITHUB_REPOSITORY;

  if ((!pullNumber || !repository) && process.env.GITHUB_EVENT_PATH) {
    const event = JSON.parse(
      await import("node:fs").then(({ readFileSync }) =>
        readFileSync(requireEnv("GITHUB_EVENT_PATH"), "utf8"),
      ),
    ) as {
      pull_request?: { number?: number };
      number?: number;
      repository?: { full_name?: string };
    };
    pullNumber =
      pullNumber ??
      event.pull_request?.number ??
      event.number;
    repository = repository ?? event.repository?.full_name;
  }

  if (!pullNumber || !repository) {
    console.log(
      `Cannot publish: event=${eventName} pullNumber=${pullNumber} repository=${repository}`,
    );
    return;
  }

  const published = await publishPullRequestComment({
    token,
    repository,
    pullNumber,
    body,
  });
  console.log(`Published review comment: ${published.url}`);
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
