import { spawn } from "node:child_process";

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ExecOptions {
  cwd?: string;
  timeoutMs?: number;
}

export class CommandNotFoundError extends Error {
  constructor(readonly bin: string) {
    super(`\`${bin}\` was not found in PATH`);
  }
}

export function exec(bin: string, args: string[], { cwd, timeoutMs = 30_000 }: ExecOptions = {}): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
      killSignal: "SIGTERM",
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (err: NodeJS.ErrnoException) =>
      reject(err.code === "ENOENT" ? new CommandNotFoundError(bin) : err),
    );
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}
