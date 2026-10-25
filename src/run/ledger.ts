import type { AgentResult } from "../agent/runAgent.js";

export interface LedgerEntry {
  phase: "init" | "review" | "verify" | "thread";
  findingId?: string;
  sessionId: string;
  model?: string;
  tokens?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
  durationMs: number;
  costUsd: number | null;
}

export function ledgerEntry(phase: LedgerEntry["phase"], result: AgentResult, model?: string): LedgerEntry {
  return {
    phase,
    sessionId: result.session_id,
    model,
    tokens: result.usage && {
      input: result.usage.inputTokens,
      output: result.usage.outputTokens,
      cacheRead: result.usage.cacheReadTokens,
      cacheWrite: result.usage.cacheWriteTokens,
    },
    durationMs: result.duration_ms,
    costUsd: null,
  };
}
