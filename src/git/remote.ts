import { exec } from "../exec.js";
import type { Platform } from "./host.js";

export interface Remote {
  url: string;
  host: string;
  path: string;
}

const SCP_LIKE = /^(?:[^@/]+@)?([^:/]+):(.+)$/;

export function parseRemote(url: string): Remote | null {
  let host: string;
  let path: string;
  if (url.includes("://")) {
    try {
      const parsed = new URL(url);
      host = parsed.hostname;
      path = parsed.pathname;
    } catch {
      return null;
    }
  } else {
    const [, scpHost, scpPath] = SCP_LIKE.exec(url) ?? [];
    if (!scpHost || !scpPath) return null;
    host = scpHost;
    path = scpPath;
  }
  path = path.replace(/^\/+|\/+$/g, "").replace(/\.git$/, "");
  return host && path ? { url, host, path } : null;
}

export async function getRemote(cwd: string, name = "origin"): Promise<Remote | null> {
  const { code, stdout } = await exec("git", ["remote", "get-url", name], { cwd });
  return code === 0 ? parseRemote(stdout.trim()) : null;
}

export interface RepoLinks {
  name: string;
  url: string;
  mrUrl: string;
}

export function repoLinks(remote: Remote, platform: Platform, mrId: number): RepoLinks {
  const url = `https://${remote.host}/${remote.path}`;
  return {
    name: remote.path.split("/").pop() ?? remote.path,
    url,
    mrUrl: platform === "gitlab" ? `${url}/-/merge_requests/${mrId}` : `${url}/pull/${mrId}`,
  };
}
