import { z } from "zod";
import { exec } from "../exec.js";
import { AgentError, classifyAgentFailure, classifyAgentText } from "./errors.js";

const AgentResult = z.object({
  is_error: z.boolean().optional(),
  result: z.string(),
  session_id: z.string(),
  duration_ms: z.number(),
  usage: z
    .object({
      inputTokens: z.number().optional(),
      outputTokens: z.number().optional(),
      cacheReadTokens: z.number().optional(),
      cacheWriteTokens: z.number().optional(),
    })
    .optional(),
});
export type AgentResult = z.infer<typeof AgentResult>;

export interface RunAgentOptions {
  cwd: string;
  model?: string;
  mode?: "ask" | "plan";
  sessionId?: string;
}

const RETRY_DELAYS_MS = [5_000, 15_000, 45_000];
const DEFAULT_TIMEOUT_MS = 600_000;

export interface AgentRetry {
  attempt: number;
  of: number;
  delayMs: number;
}

type RetryListener = (retry: AgentRetry) => void;

let retryListener: RetryListener | undefined;

export function onAgentRetry(listener: RetryListener | undefined): void {
  retryListener = listener;
}

export async function runAgent(prompt: string, options: RunAgentOptions): Promise<AgentResult> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await runAgentOnce(prompt, options);
    } catch (err) {
      const delayMs = RETRY_DELAYS_MS[attempt];
      if (!(err instanceof AgentError) || err.kind !== "rate-limit" || delayMs === undefined) throw err;
      retryListener?.({ attempt: attempt + 1, of: RETRY_DELAYS_MS.length, delayMs });
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

async function runAgentOnce(prompt: string, { cwd, model, mode, sessionId }: RunAgentOptions): Promise<AgentResult> {
  const args = ["-p", "--trust", "--output-format", "json"];
  if (mode) args.push("--mode", mode);
  if (model) args.push("--model", model);
  if (sessionId) args.push("--resume", sessionId);
  args.push(prompt);

  const timeoutMs = Number(process.env.LGTM_AGENT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  const run = await exec("agent", args, { cwd, timeoutMs });
  if (run.code !== 0 || run.signal) throw classifyAgentFailure(run);

  const result = AgentResult.parse(JSON.parse(run.stdout));
  if (result.is_error) throw classifyAgentText(result.result);
  return result;
}
