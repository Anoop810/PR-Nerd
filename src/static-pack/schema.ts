import { z } from "zod";

export const ChangedFileStatusSchema = z.enum([
  "added",
  "modified",
  "deleted",
  "renamed",
]);
export type ChangedFileStatus = z.infer<typeof ChangedFileStatusSchema>;

export const ChangedFileSchema = z.object({
  path: z.string(),
  status: ChangedFileStatusSchema,
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  previousPath: z.string().optional(),
  language: z.string().optional(),
});
export type ChangedFile = z.infer<typeof ChangedFileSchema>;

export const SurroundingCodeSchema = z.object({
  path: z.string(),
  content: z.string(),
  truncated: z.boolean(),
  byteLength: z.number().int().nonnegative(),
});
export type SurroundingCode = z.infer<typeof SurroundingCodeSchema>;

export const ImportInfoSchema = z.object({
  file: z.string(),
  imports: z.array(z.string()),
});
export type ImportInfo = z.infer<typeof ImportInfoSchema>;

export const CommitInfoSchema = z.object({
  sha: z.string(),
  message: z.string(),
  author: z.string(),
});
export type CommitInfo = z.infer<typeof CommitInfoSchema>;

export const StaticPackSchema = z.object({
  version: z.literal("1"),
  generatedAt: z.string(),
  repository: z.object({
    root: z.string(),
    name: z.string().optional(),
  }),
  comparison: z.object({
    base: z.string(),
    head: z.string(),
    baseSha: z.string(),
    headSha: z.string(),
  }),
  pr: z
    .object({
      number: z.number().int().optional(),
      title: z.string().optional(),
      body: z.string().optional(),
      author: z.string().optional(),
      url: z.string().optional(),
    })
    .optional(),
  git: z.object({
    commits: z.array(CommitInfoSchema),
  }),
  changedFiles: z.array(ChangedFileSchema),
  diff: z.object({
    text: z.string(),
    truncated: z.boolean(),
    totalBytes: z.number().int().nonnegative(),
  }),
  surroundingCode: z.array(SurroundingCodeSchema),
  imports: z.array(ImportInfoSchema),
  relatedTests: z.array(z.string()),
  repositoryInstructions: z.string().nullable(),
  fileStructure: z.object({
    text: z.string(),
    truncated: z.boolean(),
  }),
  bounds: z.object({
    maxDiffBytes: z.number().int(),
    maxFileBytes: z.number().int(),
    maxStructureEntries: z.number().int(),
  }),
});
export type StaticPack = z.infer<typeof StaticPackSchema>;
