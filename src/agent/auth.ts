import { z } from "zod";
import { CommandNotFoundError, exec } from "../exec.js";
import { type Model, parseModels } from "./models.js";

const execAgent = (args: string[]) => exec("agent", args);

const AgentStatus = z.object({
  status: z.string(),
  isAuthenticated: z.boolean(),
  message: z.string().optional(),
});

export type AuthCheck =
  | { kind: "missing" }
  | { kind: "logged-out"; version: string; message: string }
  | { kind: "rejected"; version: string; message: string; reason: string }
  | { kind: "ok"; version: string; message: string; models: Model[] };

export async function checkAuth(): Promise<AuthCheck> {
  let version: string;
  try {
    version = (await execAgent(["--version"])).stdout.trim();
  } catch (err) {
    if (err instanceof CommandNotFoundError) return { kind: "missing" };
    throw err;
  }

  const raw = await execAgent(["status", "--format", "json"]);
  const status = AgentStatus.parse(JSON.parse(raw.stdout));
  const message = status.message ?? status.status;
  if (!status.isAuthenticated) return { kind: "logged-out", version, message };

  const probe = await execAgent(["models"]);
  if (probe.code !== 0) {
    const reason = (probe.stderr || probe.stdout).trim().replace(/^Error:\s*/, "");
    return { kind: "rejected", version, message, reason };
  }

  return { kind: "ok", version, message, models: parseModels(probe.stdout) };
}
