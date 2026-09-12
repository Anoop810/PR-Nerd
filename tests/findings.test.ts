import { describe, expect, it } from "vitest";
import {
  ReviewResultSchema,
  meetsSeverityThreshold,
} from "../src/review/findings.js";
import {
  parseSubmitReviewArgs,
  parseReviewFromContent,
} from "../src/agent/loop.js";

describe("structured review parsing", () => {
  it("parses a valid submit_review payload", () => {
    const result = parseSubmitReviewArgs(
      JSON.stringify({
        summary: "Looks mostly fine",
        confidence: "high",
        investigatedFiles: ["src/a.ts"],
        findings: [
          {
            file: "src/a.ts",
            line: 10,
            severity: "high",
            title: "Null deref",
            explanation: "user can be undefined",
            suggestion: "Add a null check",
            category: "bug",
          },
        ],
      }),
      "medium",
    );
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.title).toBe("Null deref");
  });

  it("returns empty findings safely for malformed JSON", () => {
    const result = parseSubmitReviewArgs("not-json {{{", "medium");
    expect(result.findings).toEqual([]);
    expect(result.confidence).toBe("low");
    expect(result.summary.toLowerCase()).toContain("malformed");
  });

  it("filters below severity threshold", () => {
    const result = parseSubmitReviewArgs(
      JSON.stringify({
        summary: "nits only",
        confidence: "medium",
        findings: [
          {
            file: "a.ts",
            line: 1,
            severity: "low",
            title: "Style",
            explanation: "prefer const",
            suggestion: null,
            category: "other",
          },
          {
            file: "a.ts",
            line: 2,
            severity: "critical",
            title: "Injection",
            explanation: "unsanitized input",
            suggestion: "sanitize",
            category: "security",
          },
        ],
      }),
      "high",
    );
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.severity).toBe("critical");
  });

  it("accepts empty findings", () => {
    const parsed = ReviewResultSchema.parse({
      summary: "No issues",
      confidence: "high",
      findings: [],
      investigatedFiles: [],
    });
    expect(parsed.findings).toEqual([]);
  });

  it("parses fenced JSON from model content", () => {
    const content = [
      "Here is my review:",
      "```json",
      JSON.stringify({
        summary: "ok",
        confidence: "medium",
        findings: [],
        investigatedFiles: [],
      }),
      "```",
    ].join("\n");
    const result = parseReviewFromContent(content, "info");
    expect(result?.summary).toBe("ok");
  });

  it("returns null for non-JSON prose", () => {
    expect(parseReviewFromContent("looks good to me", "medium")).toBeNull();
  });

  it("ranks severities", () => {
    expect(meetsSeverityThreshold("critical", "high")).toBe(true);
    expect(meetsSeverityThreshold("low", "medium")).toBe(false);
  });
});
