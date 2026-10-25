import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { USER_DIR } from "../config.js";
import { exec } from "../exec.js";
import type { MergeRequest } from "../git/mr.js";

export interface ReviewTree {
  dir: string;
  mergeBase: string;
  targetSha: string;
  git(args: string[]): Promise<string>;
  remove(): Promise<void>;
}

export async function buildReviewTree(repoRoot: string, originUrl: string, mr: MergeRequest, runId: string): Promise<ReviewTree> {
  const dir = join(USER_DIR, "tmp", runId);
  const git = async (args: string[]) => {
    const { code, stdout, stderr } = await exec("git", args, { cwd: dir, timeoutMs: 300_000 });
    if (code !== 0) throw new Error(`git ${args[0]}: ${(stderr || stdout).trim()}`);
    return stdout;
  };

  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await git(["clone", "--quiet", "--shared", "--no-checkout", repoRoot, "."]);
  await git([
    "fetch",
    "--quiet",
    "--no-tags",
    originUrl,
    `+${mr.headRef}:refs/lgtm/head`,
    `+refs/heads/${mr.targetBranch}:refs/lgtm/base`,
  ]);
  await git(["checkout", "--quiet", "--detach", mr.headSha]);
  await rm(join(dir, ".cursor"), { recursive: true, force: true });
  const mergeBase = (await git(["merge-base", mr.baseSha, mr.headSha])).trim();
  const targetSha = (await git(["rev-parse", "refs/lgtm/base"])).trim();

  return { dir, mergeBase, targetSha, git, remove: () => rm(dir, { recursive: true, force: true }) };
}
