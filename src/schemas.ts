import { z } from "zod";

export const Severity = z.preprocess(
  (value) => (typeof value === "string" ? value.toLowerCase() : value),
  z.enum(["blocking", "major", "minor", "nit"]),
);
export type Severity = z.infer<typeof Severity>;

export const Rule = z.object({
  id: z.string().min(1),
  category: z.string().min(1),
  severity: Severity,
  scope: z.array(z.string().min(1)).min(1).default(["**"]),
  rule: z.string().min(1),
  good: z.string().optional(),
  bad: z.string().optional(),
  source: z.string().optional(),
  enforcedBy: z.string().nullable().default(null),
});
export type Rule = z.infer<typeof Rule>;

export const RulesFile = z.object({
  version: z.literal(1),
  rules: z.array(Rule).refine((rules) => new Set(rules.map((r) => r.id)).size === rules.length, {
    message: "rule ids must be unique",
  }),
});

export const Finding = z.object({
  ruleId: z.string().nullable(),
  category: z.string(),
  severity: Severity,
  confidence: z.enum(["low", "medium", "high"]),
  file: z.string(),
  startLine: z.int().positive(),
  endLine: z.int().positive(),
  title: z.string(),
  body: z.string(),
  suggestion: z.string().optional(),
  evidence: z.string(),
});
export type Finding = z.infer<typeof Finding>;

export const ReviewOutput = z.object({ findings: z.array(Finding) });
