import { spawn } from "node:child_process";

export interface ExecResult {
  code: number;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

export interface ExecOptions {
  cwd?: string;
  timeoutMs?: number;
  input?: string;
}

export class CommandNotFoundError extends Error {
  constructor(readonly bin: string) {
    super(`\`${bin}\` was not found in PATH`);
  }
}

export function exec(bin: string, args: string[], { cwd, timeoutMs = 30_000, input }: ExecOptions = {}): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd,
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      timeout: timeoutMs,
      killSignal: "SIGTERM",
    });
    let stdout = "";
    let stderr = "";
    child.stdout!.on("data", (chunk) => (stdout += chunk));
    child.stderr!.on("data", (chunk) => (stderr += chunk));
    child.on("error", (err: NodeJS.ErrnoException) =>
      reject(err.code === "ENOENT" ? new CommandNotFoundError(bin) : err),
    );
    child.stdin?.on("error", () => {});
    child.stdin?.end(input);
    child.on("close", (code, signal) => resolve({ code: code ?? 1, signal, stdout, stderr }));
  });
}
