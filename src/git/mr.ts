import { z } from "zod";
import { exec } from "../exec.js";
import { classifyHostFailure } from "./errors.js";
import type { Platform } from "./host.js";

export interface MergeRequest {
  id: number;
  title: string;
  description: string;
  author: string;
  targetBranch: string;
  baseSha: string;
  headSha: string;
  headRef: string;
}

const GitLabMr = z.object({
  title: z.string(),
  description: z.string().nullable(),
  author: z.object({ username: z.string() }),
  target_branch: z.string(),
  diff_refs: z.object({ base_sha: z.string(), head_sha: z.string() }),
});

const GitHubPr = z.object({
  title: z.string(),
  body: z.string(),
  author: z.object({ login: z.string() }),
  baseRefName: z.string(),
  baseRefOid: z.string(),
  headRefOid: z.string(),
});

export async function fetchMergeRequest(platform: Platform, id: number, cwd: string): Promise<MergeRequest> {
  if (platform === "gitlab") {
    const mr = GitLabMr.parse(JSON.parse(await run("glab", ["mr", "view", String(id), "--output", "json"], id, cwd)));
    return {
      id,
      title: mr.title,
      description: mr.description ?? "",
      author: mr.author.username,
      targetBranch: mr.target_branch,
      baseSha: mr.diff_refs.base_sha,
      headSha: mr.diff_refs.head_sha,
      headRef: `refs/merge-requests/${id}/head`,
    };
  }
  const fields = "title,body,author,baseRefName,baseRefOid,headRefOid";
  const pr = GitHubPr.parse(JSON.parse(await run("gh", ["pr", "view", String(id), "--json", fields], id, cwd)));
  return {
    id,
    title: pr.title,
    description: pr.body,
    author: pr.author.login,
    targetBranch: pr.baseRefName,
    baseSha: pr.baseRefOid,
    headSha: pr.headRefOid,
    headRef: `refs/pull/${id}/head`,
  };
}

async function run(bin: string, args: string[], mrId: number, cwd: string): Promise<string> {
  const { code, stdout, stderr } = await exec(bin, args, { cwd });
  if (code !== 0) throw classifyHostFailure(bin, (stderr || stdout).trim() || `${bin} exited with code ${code}`, mrId);
  return stdout;
}
