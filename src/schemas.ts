import { z } from "zod";

export const SEVERITIES = ["blocking", "major", "minor", "nit"] as const;

export const Severity = z.preprocess(
  (value) => (typeof value === "string" ? value.toLowerCase() : value),
  z.enum(SEVERITIES),
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
  previousId: z.string().optional(),
});
export type Finding = z.infer<typeof Finding>;

export const ResolvedFinding = z.object({ previousId: z.string(), reason: z.string() });
export type ResolvedFinding = z.infer<typeof ResolvedFinding>;

export const ReviewOutput = z.object({ findings: z.array(Finding), resolved: z.array(ResolvedFinding).default([]) });

export function reviewOutputFor(openIds: string[]) {
  const open = new Set(openIds);
  return ReviewOutput.superRefine((output, ctx) => {
    const reported = [
      ...output.findings.flatMap((f) => (f.previousId === undefined ? [] : [f.previousId])),
      ...output.resolved.map((r) => r.previousId),
    ];
    const unknown = [...new Set(reported.filter((id) => !open.has(id)))];
    if (unknown.length) ctx.addIssue({ code: "custom", message: `unknown previousId: ${unknown.join(", ")}` });
    const repeated = [...new Set(reported.filter((id, i) => reported.indexOf(id) !== i))];
    if (repeated.length) ctx.addIssue({ code: "custom", message: `previousId used more than once: ${repeated.join(", ")}` });
    const missing = openIds.filter((id) => !reported.includes(id));
    if (missing.length) {
      ctx.addIssue({
        code: "custom",
        message: `previous findings neither re-emitted with previousId nor listed in resolved: ${missing.join(", ")}`,
      });
    }
  });
}

export const VERDICTS = ["keep", "downgrade", "drop"] as const;

export const Verdict = z
  .object({
    index: z.int().nonnegative(),
    verdict: z.enum(VERDICTS),
    severity: Severity.optional(),
    reason: z.string(),
  })
  .refine((v) => v.verdict !== "downgrade" || v.severity !== undefined, {
    message: "a downgrade verdict needs a severity",
  });
export type Verdict = z.infer<typeof Verdict>;

export const VerifyOutput = z.object({ verdicts: z.array(Verdict) });

export const ThreadRevision = z.object({
  severity: Severity.optional(),
  body: z.string().optional(),
  suggestion: z.string().optional(),
  withdraw: z.boolean().optional(),
});
export type ThreadRevision = z.infer<typeof ThreadRevision>;

export const ThreadReply = z.object({ reply: z.string(), revision: ThreadRevision.optional() });
export type ThreadReply = z.infer<typeof ThreadReply>;

export const FINDING_STATES = ["proposed", "edited", "accepted", "copied", "dismissed", "withdrawn"] as const;
export type FindingState = (typeof FINDING_STATES)[number];

export interface FindingText {
  body: string;
  suggestion?: string;
}

export interface ThreadMessage {
  role: "user" | "agent";
  text: string;
  at: string;
  error?: string;
  proposal?: ThreadRevision & { status: "open" | "applied" | "ignored" };
}

export interface AppliedRevision {
  at: string;
  from: FindingText & { severity: Severity };
  revision: ThreadRevision;
}

export interface FindingRecord extends Finding {
  id: string;
  state: FindingState;
  source?: "user";
  general?: true;
  verdict?: Pick<Verdict, "verdict" | "reason"> & { from?: Severity };
  original?: FindingText;
  dismissReason?: string;
  stateBeforeDismiss?: Exclude<FindingState, "dismissed" | "withdrawn">;
  thread?: ThreadMessage[];
  pending?: true;
  revisions?: AppliedRevision[];
  posted?: { at: string; url?: string };
}
