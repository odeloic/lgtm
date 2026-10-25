import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as p from "@clack/prompts";
import { readUserConfig } from "../config.js";
import { detectPlatform } from "../git/host.js";
import { fetchMergeRequest } from "../git/mr.js";
import { getRemote } from "../git/remote.js";
import { repoRoot as findRepoRoot } from "../git/repo.js";
import { DEFAULT_SKIP, readProjectConfig } from "../project.js";
import { listChangedFiles, loadVoice, writeBundle } from "../review/bundle.js";
import { reviewMergeRequest } from "../review/review.js";
import { loadBaseRules, rulesForFiles } from "../review/rules.js";
import { buildReviewTree } from "../review/tree.js";
import type { Finding, Severity } from "../schemas.js";

const SEVERITY_ORDER: Severity[] = ["blocking", "major", "minor", "nit"];

export async function review(mrId: number): Promise<number> {
  p.intro(`lgtm review !${mrId}`);
  const spin = p.spinner();

  const repoRoot = await findRepoRoot();
  const config = repoRoot ? await readProjectConfig(repoRoot) : null;
  const remote = config?.remote ?? "origin";
  const origin = repoRoot ? await getRemote(repoRoot, remote) : null;
  if (!repoRoot || !origin) {
    p.cancel(`Run \`lgtm review\` inside a git repository with a \`${remote}\` remote.`);
    return 1;
  }
  const platform = config?.provider ?? (await detectPlatform(origin.host));
  if (!platform) {
    p.cancel(`Can't tell whether ${origin.host} is GitHub or GitLab. Run \`lgtm init\` first.`);
    return 1;
  }

  spin.start(`Fetching !${mrId}`);
  const mr = await fetchMergeRequest(platform, mrId, repoRoot);
  spin.stop(`${mr.title} by ${mr.author} (${mr.headSha.slice(0, 7)})`);

  const runId = `${mr.id}-${mr.headSha.slice(0, 7)}`;
  spin.start("Building review tree");
  const tree = await buildReviewTree(repoRoot, origin.url, mr, runId);
  try {
    const files = await listChangedFiles(tree, mr.headSha, config?.skip ?? DEFAULT_SKIP);
    const baseRules = await loadBaseRules(tree, repoRoot, mr.targetBranch);
    const rules = rulesForFiles(baseRules.rules, files.reviewed);
    const voice = await loadVoice(tree);
    const diff = files.reviewed.length
      ? await tree.git(["diff", "--no-renames", tree.mergeBase, mr.headSha, "--", ...files.reviewed])
      : "";
    const bundle = await writeBundle(tree, { mr, files, rules, voice, diff });
    spin.stop(
      `${files.reviewed.length} files to review, ${files.skipped.length} skipped, ${rules.length} rules, ~${Math.round(bundle.length / 4)} tokens`,
    );
    if (baseRules.warning) p.log.warn(baseRules.warning);

    if (!files.reviewed.length) {
      p.outro("Nothing to review.");
      return 0;
    }

    const { model } = await readUserConfig();
    spin.start(`Reviewing with ${model ?? "default model"}`);
    const result = await reviewMergeRequest(mr, tree.dir, model);
    const seconds = (result.ledger.reduce((sum, e) => sum + e.durationMs, 0) / 1000).toFixed(1);

    const findings = result.findings?.map((f, i) => ({ id: `F${i + 1}`, state: "proposed" as const, ...f }));
    const runFile = join(repoRoot, ".lgtm", "runs", `${runId}.json`);
    await mkdir(join(repoRoot, ".lgtm", "runs"), { recursive: true });
    await writeFile(
      runFile,
      `${JSON.stringify(
        {
          mr: { id: mr.id, title: mr.title, author: mr.author, headSha: mr.headSha, mergeBase: tree.mergeBase, targetBranch: mr.targetBranch, targetSha: tree.targetSha },
          reviewedAt: new Date().toISOString(),
          notReviewed: files.skipped,
          findings: findings ?? [],
          ...(result.error && { error: result.error }),
          raw: result.raw,
          ledger: result.ledger,
        },
        null,
        2,
      )}\n`,
    );

    if (!findings) {
      spin.error(`Review output didn't validate after a retry (${seconds}s)`);
      p.log.message(result.error ?? "");
      p.cancel(`Raw output kept in ${runFile}`);
      return 1;
    }
    spin.stop(`${findings.length} findings in ${seconds}s`);
    printFindings(findings);
    p.outro(`Run saved to ${runFile}`);
    return 0;
  } finally {
    await tree.remove();
  }
}

function printFindings(findings: (Finding & { id: string })[]) {
  const sorted = [...findings].sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
  );
  for (const f of sorted) {
    const lines = f.startLine === f.endLine ? `${f.startLine}` : `${f.startLine}-${f.endLine}`;
    const header = `${f.id} ${f.severity} · ${f.file}:${lines} · ${f.ruleId ?? f.category} (${f.confidence})`;
    const text = [header, f.title, "", f.body, ...(f.suggestion ? ["", "suggestion:", f.suggestion] : [])].join("\n");
    if (f.severity === "blocking") p.log.error(text);
    else if (f.severity === "major") p.log.warn(text);
    else p.log.info(text);
  }
}
