import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { MergeRequest } from "../git/mr.js";
import type { ReviewTree } from "./tree.js";

const PreviousFinding = z.object({
  id: z.string(),
  state: z.string(),
  source: z.string().optional(),
  severity: z.string(),
  file: z.string(),
  startLine: z.int(),
  endLine: z.int(),
  title: z.string(),
  body: z.string(),
  dismissReason: z.string().optional(),
  verdict: z.object({ verdict: z.string() }).optional(),
});
export type PreviousFinding = z.infer<typeof PreviousFinding>;

const RunFile = z.object({
  mr: z.object({ headSha: z.string() }),
  reviewedAt: z.string(),
  pass: z.int().positive().optional(),
  findings: z.array(PreviousFinding),
  dismissedEarlier: z.array(PreviousFinding).default([]),
});

export type Increment = { kind: "diff"; diff: string } | { kind: "unavailable" };

export interface ReviewHistory {
  pass: number;
  previousRun?: string;
  previousHead?: string;
  increment?: Increment;
  findings: PreviousFinding[];
}

export const isDismissed = (f: PreviousFinding) => f.state === "dismissed" || f.state === "withdrawn";

export function openPreviousIds(history: ReviewHistory): string[] {
  return history.findings.filter((f) => !isDismissed(f)).map((f) => f.id);
}

export async function loadHistory(
  repoRoot: string,
  tree: ReviewTree,
  mr: MergeRequest,
  reviewed: string[],
): Promise<ReviewHistory> {
  const dir = join(repoRoot, ".lgtm", "runs");
  const names = await readdir(dir).catch(() => [] as string[]);
  const prefix = `${mr.id}-`;
  const runs = (
    await Promise.all(
      names
        .filter((n) => n.startsWith(prefix) && n.endsWith(".json") && !n.endsWith(".failed.json"))
        .map(async (name) => {
          try {
            return { name, run: RunFile.parse(JSON.parse(await readFile(join(dir, name), "utf8"))) };
          } catch {
            return null;
          }
        }),
    )
  )
    .filter((r) => r !== null)
    .sort((a, b) => b.run.reviewedAt.localeCompare(a.run.reviewedAt));

  const rerun = runs.find((r) => r.run.mr.headSha === mr.headSha);
  const previous = runs.find((r) => r.run.mr.headSha !== mr.headSha);
  if (!previous) return { pass: rerun?.run.pass ?? 1, findings: [] };

  const previousHead = previous.run.mr.headSha;
  const pass = rerun ? (rerun.run.pass ?? 1) : (previous.run.pass ?? 1) + 1;
  return {
    pass,
    previousRun: previous.name,
    previousHead,
    increment: await incrementSince(tree, previousHead, mr.headSha, reviewed),
    findings: [...previous.run.findings.filter((f) => f.source !== "user" && f.verdict?.verdict !== "drop"), ...previous.run.dismissedEarlier],
  };
}

async function incrementSince(tree: ReviewTree, from: string, to: string, reviewed: string[]): Promise<Increment> {
  try {
    await tree.git(["merge-base", "--is-ancestor", from, to]);
  } catch {
    return { kind: "unavailable" };
  }
  const diff = reviewed.length ? await tree.git(["diff", "--no-renames", from, to, "--", ...reviewed]) : "";
  return { kind: "diff", diff };
}
