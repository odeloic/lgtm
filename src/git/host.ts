import { checkCliAuth } from "./auth.js";

export type Platform = "github" | "gitlab";

export const PLATFORM_NAME: Record<Platform, string> = { github: "GitHub", gitlab: "GitLab" };

export async function detectPlatform(host: string): Promise<Platform | null> {
  if (host === "github.com") return "github";
  if (host === "gitlab.com") return "gitlab";
  if ((await checkCliAuth("github", host)).kind === "ok") return "github";
  if ((await checkCliAuth("gitlab", host)).kind === "ok") return "gitlab";
  if (host.includes("gitlab")) return "gitlab";
  return null;
}
