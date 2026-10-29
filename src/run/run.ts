import type { CiStatus } from "../git/ciStatus.js";
import type { Platform } from "../git/host.js";
import type { Score } from "../review/score.js";
import type { FindingRecord, Rule } from "../schemas.js";
import type { LedgerEntry } from "./ledger.js";

export interface RunFile {
  mr: { id: number; title: string; author: string; headSha: string; mergeBase: string; targetBranch: string; targetSha: string };
  ci?: CiStatus;
  reviewedAt: string;
  pass?: number;
  findings: FindingRecord[];
  score: Score;
  rules: Pick<Rule, "id" | "category">[];
  diff: string;
  sessionId: string;
  platform: Platform;
  ledger: LedgerEntry[];
}
