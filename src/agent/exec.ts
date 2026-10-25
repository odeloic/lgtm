import { spawn } from "node:child_process";

export const AGENT_BIN = "agent";

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export class AgentNotFoundError extends Error {
  constructor() {
    super(`\`${AGENT_BIN}\` was not found in PATH`);
  }
}

export function execAgent(args: string[], timeoutMs = 30_000): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(AGENT_BIN, args, {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
      killSignal: "SIGTERM",
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (err: NodeJS.ErrnoException) =>
      reject(err.code === "ENOENT" ? new AgentNotFoundError() : err),
    );
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}
