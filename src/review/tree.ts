import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { USER_DIR } from "../config.js";
import { exec } from "../exec.js";
import type { MergeRequest } from "../git/mr.js";

const CURSOR_PERMISSIONS = {
  permissions: {
    allow: ["Read(**)"],
    deny: ["Write(**)", "Shell(*)", "Read(.env*)", "Read(**/.env*)", "Read(**/*.pem)", "Read(**/*.key)"],
  },
};

export interface ReviewTree {
  dir: string;
  mergeBase: string;
  targetSha: string;
  git(args: string[]): Promise<string>;
  remove(): Promise<void>;
}

export class ReviewedCommitGone extends Error {
  constructor(readonly sha: string) {
    super(`${sha.slice(0, 7)} is not reachable any more`);
  }
}

export function reviewTreePath(runId: string): string {
  return join(USER_DIR, "tmp", runId);
}

export async function buildReviewTree(repoRoot: string, originUrl: string, mr: MergeRequest, runId: string): Promise<ReviewTree> {
  const dir = reviewTreePath(runId);
  const git = async (args: string[]) => {
    const { code, stdout, stderr } = await exec("git", ["-c", "core.quotePath=false", ...args], { cwd: dir, timeoutMs: 300_000 });
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
  const reachable = await git(["cat-file", "-e", `${mr.headSha}^{commit}`]).then(
    () => true,
    () => false,
  );
  if (!reachable) {
    await rm(dir, { recursive: true, force: true });
    throw new ReviewedCommitGone(mr.headSha);
  }
  await git(["checkout", "--quiet", "--detach", mr.headSha]);
  await rm(join(dir, ".cursor"), { recursive: true, force: true });
  await mkdir(join(dir, ".cursor"));
  await writeFile(join(dir, ".cursor", "cli.json"), `${JSON.stringify(CURSOR_PERMISSIONS, null, 2)}\n`);
  const mergeBase = (await git(["merge-base", mr.baseSha, mr.headSha])).trim();
  const targetSha = (await git(["rev-parse", "refs/lgtm/base"])).trim();

  return { dir, mergeBase, targetSha, git, remove: () => rm(dir, { recursive: true, force: true }) };
}
