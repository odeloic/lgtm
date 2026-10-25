import { z } from "zod";
import { exec } from "../exec.js";

const AgentResult = z.object({
  is_error: z.boolean().optional(),
  result: z.string(),
  session_id: z.string(),
  duration_ms: z.number(),
  usage: z.looseObject({}).optional(),
});
export type AgentResult = z.infer<typeof AgentResult>;

export interface RunAgentOptions {
  cwd: string;
  model?: string;
  mode?: "ask" | "plan";
  sessionId?: string;
}

export async function runAgent(prompt: string, { cwd, model, mode, sessionId }: RunAgentOptions): Promise<AgentResult> {
  const args = ["-p", "--trust", "--output-format", "json"];
  if (mode) args.push("--mode", mode);
  if (model) args.push("--model", model);
  if (sessionId) args.push("--resume", sessionId);
  args.push(prompt);

  const { code, stdout, stderr } = await exec("agent", args, { cwd, timeoutMs: 600_000 });
  if (code !== 0) throw new Error((stderr || stdout).trim() || `agent exited with code ${code}`);

  const result = AgentResult.parse(JSON.parse(stdout));
  if (result.is_error) throw new Error(result.result);
  return result;
}
