import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import * as p from "@clack/prompts";
import { requireAgent, showRetries } from "../agent/require.js";
import { readUserConfig } from "../config.js";
import { fetchMergeRequest } from "../git/mr.js";
import { getRemote } from "../git/remote.js";
import { repoRoot as findRepoRoot } from "../git/repo.js";
import { readProjectConfig } from "../project.js";
import { ReviewedCommitGone, buildReviewTree, reviewTreePath } from "../review/tree.js";
import type { RunFile } from "../run/run.js";
import { type ServeOptions, removeTreeOnSignal, serveRun } from "./serve.js";

interface SavedRun {
  file: string;
  runId: string;
  run: RunFile;
}

export async function open(mrId: number, options: ServeOptions): Promise<number> {
  p.intro(`lgtm open !${mrId}`);
  const spin = p.spinner();
  const stopShowingRetries = showRetries(spin);

  try {
    await requireAgent(spin);

    const repoRoot = await findRepoRoot();
    const config = repoRoot ? await readProjectConfig(repoRoot) : null;
    const remote = config?.remote ?? "origin";
    const origin = repoRoot ? await getRemote(repoRoot, remote) : null;
    if (!repoRoot || !origin) {
      p.cancel(`Run \`lgtm open\` inside a git repository with a \`${remote}\` remote.`);
      return 1;
    }

    const saved = await latestRun(join(repoRoot, ".lgtm", "runs"), mrId);
    if (saved === "none") {
      p.cancel(`No saved review of !${mrId}. Run \`lgtm review --mr ${mrId}\`.`);
      return 1;
    }
    if (saved === "legacy") {
      p.cancel(`The saved reviews of !${mrId} predate the review page. Run \`lgtm review --mr ${mrId}\`.`);
      return 1;
    }
    const { file, runId, run } = saved;

    if (existsSync(reviewTreePath(runId))) {
      p.cancel(`${runId} is already being served by another lgtm process. Stop it first, or delete ${reviewTreePath(runId)} if none is running.`);
      return 1;
    }

    spin.start(`Fetching !${mrId}`);
    const current = await fetchMergeRequest(run.platform, mrId, repoRoot);
    spin.stop(`${run.mr.title} reviewed at ${run.mr.headSha.slice(0, 7)}`);
    if (current.headSha !== run.mr.headSha) {
      p.log.warn(`!${mrId} has new commits since this review; run \`lgtm review --mr ${mrId}\` for pass ${(run.pass ?? 1) + 1}`);
    }

    const stopRemovingTree = removeTreeOnSignal(runId);
    try {
      spin.start("Building review tree");
      let treeDir: string | undefined;
      let removeTree = async () => {};
      try {
        const tree = await buildReviewTree(
          repoRoot,
          origin.url,
          { ...current, headSha: run.mr.headSha, baseSha: run.mr.mergeBase, targetBranch: run.mr.targetBranch },
          runId,
        );
        treeDir = tree.dir;
        removeTree = tree.remove;
        spin.stop("Review tree ready");
      } catch (err) {
        if (!(err instanceof ReviewedCommitGone)) throw err;
        spin.stop("Reviewed commit is gone");
        p.log.warn(`${run.mr.headSha.slice(0, 7)} was force-pushed away, threads are disabled`);
      }

      try {
        const { model } = await readUserConfig();
        await serveRun({ runFile: file, repoRoot, treeDir, model, options });
      } finally {
        await removeTree();
      }
    } finally {
      stopRemovingTree();
    }
    return 0;
  } catch (err) {
    spin.error("Open failed");
    throw err;
  } finally {
    stopShowingRetries();
  }
}

async function latestRun(runsDir: string, mrId: number): Promise<SavedRun | "none" | "legacy"> {
  const names = await readdir(runsDir).catch(() => [] as string[]);
  const candidates = names.filter((n) => n.startsWith(`${mrId}-`) && n.endsWith(".json") && !n.endsWith(".failed.json"));
  if (!candidates.length) return "none";

  const runs: SavedRun[] = [];
  for (const name of candidates) {
    const file = join(runsDir, name);
    const run = await readFile(file, "utf8").then(
      (text) => JSON.parse(text) as RunFile,
      () => null,
    );
    if (run?.sessionId && run.diff !== undefined) runs.push({ file, runId: name.slice(0, -".json".length), run });
  }
  runs.sort((a, b) => b.run.reviewedAt.localeCompare(a.run.reviewedAt));
  return runs[0] ?? "legacy";
}
