import { checkCliAuth } from "./auth.js";

export type Platform = "github" | "gitlab";

export const PLATFORM_NAME: Record<Platform, string> = { github: "GitHub", gitlab: "GitLab" };

export async function detectPlatform(host: string): Promise<Platform | null> {
  if (host === "github.com") return "github";
  if (host === "gitlab.com") return "gitlab";
  if ((await checkCliAuth("github", host)).kind === "ok") return "github";
  if ((await checkCliAuth("gitlab", host)).kind === "ok") return "gitlab";
  if (await answersAsGitLab(host)) return "gitlab";
  if (host.includes("gitlab")) return "gitlab";
  return null;
}

async function answersAsGitLab(host: string): Promise<boolean> {
  try {
    const response = await fetch(`https://${host}/api/v4/version`, { signal: AbortSignal.timeout(5_000) });
    if (!response.headers.get("content-type")?.includes("json")) return false;
    const body = (await response.json()) as { message?: unknown; version?: unknown };
    return response.status === 401 ? body.message === "401 Unauthorized" : response.ok && "version" in body;
  } catch {
    return false;
  }
}
