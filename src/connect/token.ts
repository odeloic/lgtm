import { exec } from "../exec.js";
import { CLI } from "../git/auth.js";
import type { Platform } from "../git/host.js";
import { loadStoredToken } from "./credentials.js";

export type TokenSource = "flag" | "env" | "cli" | "stored";

const ENV_VARS: Record<Platform, string[]> = {
  github: ["GITHUB_TOKEN", "GH_TOKEN"],
  gitlab: ["GITLAB_TOKEN"],
};

const CLI_TOKEN_ARGS: Record<Platform, (host: string) => string[]> = {
  github: (host) => ["auth", "token", "--hostname", host],
  gitlab: (host) => ["config", "get", "token", "--host", host],
};

export async function findToken(
  platform: Platform,
  host: string,
  flagToken?: string,
): Promise<{ token: string; source: TokenSource } | null> {
  if (flagToken) return { token: flagToken, source: "flag" };

  const fromEnv = ENV_VARS[platform].map((name) => process.env[name]).find(Boolean);
  if (fromEnv) return { token: fromEnv, source: "env" };

  try {
    const { code, stdout } = await exec(CLI[platform], CLI_TOKEN_ARGS[platform](host));
    if (code === 0 && stdout.trim()) return { token: stdout.trim(), source: "cli" };
  } catch {}

  const stored = await loadStoredToken(host);
  return stored ? { token: stored, source: "stored" } : null;
}

export async function verifyToken(platform: Platform, host: string, token: string): Promise<string | null> {
  const request: { url: string; headers: Record<string, string> } =
    platform === "gitlab"
      ? { url: `https://${host}/api/v4/user`, headers: { "PRIVATE-TOKEN": token } }
      : {
          url: host === "github.com" ? "https://api.github.com/user" : `https://${host}/api/v3/user`,
          headers: { Authorization: `Bearer ${token}` },
        };
  try {
    const response = await fetch(request.url, { headers: request.headers, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return null;
    const user = (await response.json()) as { username?: string; login?: string };
    return user.username ?? user.login ?? null;
  } catch {
    return null;
  }
}
