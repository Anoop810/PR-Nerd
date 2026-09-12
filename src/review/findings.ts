import { z } from "zod";

export const SeveritySchema = z.enum([
  "critical",
  "high",
  "medium",
  "low",
  "info",
]);
export type Severity = z.infer<typeof SeveritySchema>;

export const FindingCategorySchema = z.enum([
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
]);
export type FindingCategory = z.infer<typeof FindingCategorySchema>;

export const FindingSchema = z.object({
  file: z.string().min(1),
  line: z.number().int().positive().nullable(),
  severity: SeveritySchema,
  title: z.string().min(1).max(200),
  explanation: z.string().min(1),
  suggestion: z.string().nullable(),
  category: FindingCategorySchema.default("other"),
});
export type Finding = z.infer<typeof FindingSchema>;

export const ReviewResultSchema = z.object({
  summary: z.string().min(1),
  findings: z.array(FindingSchema),
  confidence: z.enum(["high", "medium", "low"]),
  investigatedFiles: z.array(z.string()).default([]),
});
export type ReviewResult = z.infer<typeof ReviewResultSchema>;

export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

export const meetsSeverityThreshold = (
  severity: Severity,
  threshold: Severity,
): boolean => SEVERITY_RANK[severity] >= SEVERITY_RANK[threshold];
