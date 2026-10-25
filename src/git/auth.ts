import { CommandNotFoundError, exec } from "../exec.js";
import type { Platform } from "./host.js";

export const CLI: Record<Platform, string> = { github: "gh", gitlab: "glab" };

export type CliAuth = { kind: "missing" | "logged-out" | "ok"; bin: string };

const STATUS_ARGS: Record<Platform, (host: string) => string[]> = {
  github: (host) => ["auth", "status", "--hostname", host, "--active"],
  gitlab: (host) => ["auth", "status", "--hostname", host],
};

export async function checkCliAuth(platform: Platform, host: string): Promise<CliAuth> {
  const bin = CLI[platform];
  try {
    const { code } = await exec(bin, STATUS_ARGS[platform](host));
    return { kind: code === 0 ? "ok" : "logged-out", bin };
  } catch (err) {
    if (err instanceof CommandNotFoundError) return { kind: "missing", bin };
    throw err;
  }
}
