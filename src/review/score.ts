import type { FindingRecord, Rule, Severity } from "../schemas.js";

const WEIGHTS: Record<Severity, number> = { blocking: 15, major: 8, minor: 3, nit: 0 };

export interface Score {
  score: number;
  byCategory: Record<string, number>;
}

export function scoreFindings(findings: FindingRecord[], rules: Pick<Rule, "id" | "category">[]): Score {
  const categoryByRule = new Map(rules.map((r) => [r.id, r.category]));
  const byCategory: Record<string, number> = {};
  let total = 0;
  for (const f of findings) {
    if ((f.verdict?.verdict === "drop" && f.state === "proposed") || f.state === "dismissed" || f.state === "withdrawn") continue;
    const weight = WEIGHTS[f.severity];
    const category = (f.ruleId && categoryByRule.get(f.ruleId)) || f.category;
    byCategory[category] = (byCategory[category] ?? 0) + weight;
    total += weight;
  }
  return { score: Math.max(0, 100 - total), byCategory };
}
