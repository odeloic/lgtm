import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as p from "@clack/prompts";
import { requireAgent, showRetries } from "../agent/require.js";
import { readUserConfig } from "../config.js";
import { summarizeError } from "../errors.js";
import { type Discussion, fetchDiscussions } from "../git/discussions.js";
import { fetchCi } from "../git/ci.js";
import { ciLabel, type CiStatus } from "../git/ciStatus.js";
import { type Platform, detectPlatform } from "../git/host.js";
import { type MergeRequest, fetchMergeRequest } from "../git/mr.js";
import { getRemote } from "../git/remote.js";
import { repoRoot as findRepoRoot } from "../git/repo.js";
import { DEFAULT_SKIP, type ProjectConfig, readProjectConfig } from "../project.js";
import { anchorFindings } from "../review/anchor.js";
import { listChangedFiles, loadVoice, writeBundle } from "../review/bundle.js";
import { type ReviewHistory, isDismissed, loadHistory, openPreviousIds } from "../review/history.js";
import { reviewMergeRequest } from "../review/review.js";
import { loadBaseRules, rulesForFiles } from "../review/rules.js";
import { type Score, scoreFindings } from "../review/score.js";
import { type ReviewTree, buildReviewTree } from "../review/tree.js";
import { applyVerdicts, verifyFindings } from "../review/verify.js";
import type { LedgerEntry } from "../run/ledger.js";
import type { FindingRecord, ResolvedFinding, Severity } from "../schemas.js";
import { type ServeOptions, removeTreeOnSignal, serveRun } from "./serve.js";

const SEVERITY_ORDER: Severity[] = ["blocking", "major", "minor", "nit"];

export async function review(mrId: number, options: ServeOptions, rulesFile?: string): Promise<number> {
  p.intro(`lgtm review !${mrId}`);
  const spin = p.spinner();
  const stopShowingRetries = showRetries(spin);

  try {
    await requireAgent(spin);

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

    spin.start("Fetching CI");
    const ci = await fetchCi(platform, mrId, mr.headSha, repoRoot);
    spin.stop(ciLabel(ci));
    if (ci.warning) p.log.warn(ci.warning);

    spin.start("Reading discussions");
    const discussions = await fetchDiscussions(platform, mrId, repoRoot);
    spin.stop(`Read ${discussions.length} thread${discussions.length === 1 ? "" : "s"}`);

    const runId = `${mr.id}-${mr.headSha.slice(0, 7)}`;
    const curated = await curatedWork(join(repoRoot, ".lgtm", "runs", `${runId}.json`));
    if (curated) {
      const overwrite = await p.confirm({
        message: `You already worked on the review of ${mr.headSha.slice(0, 7)} (${curated}). Review again and overwrite it?`,
        initialValue: false,
      });
      if (p.isCancel(overwrite) || !overwrite) {
        p.outro("Kept the existing review.");
        return 0;
      }
    }

    const stopRemovingTree = removeTreeOnSignal(runId);

    spin.start("Building review tree");
    const tree = await buildReviewTree(repoRoot, origin.url, mr, runId);
    try {
      return await reviewTree({ spin, tree, repoRoot, config, mr, runId, discussions, platform, options, rulesFile, ci });
    } finally {
      stopRemovingTree();
      await tree.remove();
    }
  } catch (err) {
    spin.error("Review failed");
    throw err;
  } finally {
    stopShowingRetries();
  }
}

interface ReviewTreeInput {
  spin: ReturnType<typeof p.spinner>;
  tree: ReviewTree;
  repoRoot: string;
  config: ProjectConfig | null;
  mr: MergeRequest;
  runId: string;
  discussions: Discussion[];
  platform: Platform;
  options: ServeOptions;
  rulesFile?: string;
  ci: CiStatus;
}

async function reviewTree({ spin, tree, repoRoot, config, mr, runId, discussions, platform, options, rulesFile, ci }: ReviewTreeInput): Promise<number> {
  const files = await listChangedFiles(tree, mr.headSha, config?.skip ?? DEFAULT_SKIP);
  const baseRules = await loadBaseRules(tree, repoRoot, mr.targetBranch, rulesFile);
  const rules = rulesForFiles(baseRules.rules, files.reviewed);
  const voice = await loadVoice(tree);
  const diff = files.reviewed.length
    ? await tree.git(["diff", "--no-renames", tree.mergeBase, mr.headSha, "--", ...files.reviewed])
    : "";
  const history = await loadHistory(repoRoot, tree, mr, files.reviewed);
  const bundle = await writeBundle(tree, { mr, files, rules, voice, diff, discussions, history, ci });
  spin.stop(
    `${files.reviewed.length} files to review, ${files.skipped.length} skipped, ${rules.length} rules, ~${Math.round(bundle.length / 4)} tokens`,
  );
  if (baseRules.warning) p.log.warn(baseRules.warning);

  if (!files.reviewed.length) {
    p.outro("Nothing to review.");
    return 0;
  }

  const { model, verifyModel = model } = await readUserConfig();
  const ledger: LedgerEntry[] = [];
  const seconds = (phase?: LedgerEntry["phase"]) =>
    (ledger.filter((e) => !phase || e.phase === phase).reduce((sum, e) => sum + e.durationMs, 0) / 1000).toFixed(1);

  const runFile = join(repoRoot, ".lgtm", "runs", `${runId}.json`);
  const failedRunFile = join(repoRoot, ".lgtm", "runs", `${runId}.failed.json`);
  let raw: string | undefined;
  let verifyRaw: string | undefined;
  const saveRun = async (extra: object, file = runFile) => {
    await mkdir(join(repoRoot, ".lgtm", "runs"), { recursive: true });
    await writeFile(
      file,
      `${JSON.stringify(
        {
          mr: { id: mr.id, title: mr.title, author: mr.author, headSha: mr.headSha, mergeBase: tree.mergeBase, targetBranch: mr.targetBranch, targetSha: tree.targetSha },
          reviewedAt: new Date().toISOString(),
          ci,
          notReviewed: files.skipped,
          pass: history.pass,
          ...(history.previousRun && { previousRun: history.previousRun, previousHead: history.previousHead }),
          discussions: discussions.length,
          ...extra,
          raw,
          ...(verifyRaw !== undefined && { verifyRaw }),
          ledger,
        },
        null,
        2,
      )}\n`,
    );
  };

  let findings: FindingRecord[] = [];
  let resolved: ResolvedFinding[] = [];
  let verifyError: string | undefined;
  let sessionId = "";
  try {
    spin.start(`Reviewing with ${model ?? "default model"}`);
    const result = await reviewMergeRequest(mr, tree.dir, openPreviousIds(history), model, ledger);
    raw = result.raw;
    resolved = result.resolved;
    sessionId = result.sessionId;

    if (!result.findings) {
      await saveRun({ findings: [], error: result.error }, failedRunFile);
      spin.error(`Review output didn't validate after a retry (${seconds()}s)`);
      p.log.message(result.error ?? "");
      p.cancel(`Raw output kept in ${failedRunFile}`);
      return 1;
    }
    spin.stop(`${result.findings.length} findings in ${seconds()}s`);

    findings = anchorFindings(
      result.findings.map((f, i) => ({ id: `F${i + 1}`, state: "proposed" as const, ...f })),
      diff,
    );
    if (findings.length) {
      spin.start(`Verifying ${findings.length} findings with ${verifyModel ?? "default model"}`);
      const verification = await verifyFindings(findings, ci, tree.dir, verifyModel, ledger);
      verifyRaw = verification.raw;
      if (verification.verdicts) {
        findings = applyVerdicts(findings, verification.verdicts);
        spin.stop(`Verified in ${seconds("verify")}s`);
      } else {
        verifyError = verification.error;
        spin.error("Verify output didn't validate after a retry, findings left unverified");
        p.log.message(verifyError ?? "");
      }
    }
  } catch (err) {
    const saved = await saveRun({ findings, error: summarizeError(err) }, failedRunFile).then(
      () => true,
      () => false,
    );
    if (saved) p.log.info(`Partial run saved to ${failedRunFile}`);
    throw err;
  }

  const score = scoreFindings(findings, baseRules.rules);
  const dismissedEarlier = history.findings.filter(isDismissed);
  const ruleCategories = baseRules.rules.map(({ id, category }) => ({ id, category }));
  await saveRun({ findings, resolved, dismissedEarlier, score, rules: ruleCategories, diff, sessionId, platform, ...(verifyError && { verifyError }) });
  p.log.message(ciLabel(ci));
  printReport(findings, score);
  p.log.message(passSummary(history, findings, resolved, discussions.length));
  p.log.info(`Run saved to ${runFile}`);

  await serveRun({ runFile, repoRoot, treeDir: tree.dir, model, options });
  return 0;
}

async function curatedWork(runFile: string): Promise<string | null> {
  let findings: FindingRecord[];
  try {
    findings = (JSON.parse(await readFile(runFile, "utf8")) as { findings?: FindingRecord[] }).findings ?? [];
  } catch {
    return null;
  }
  const counts = new Map<string, number>();
  const add = (label: string) => counts.set(label, (counts.get(label) ?? 0) + 1);
  for (const f of findings) {
    if (f.source === "user") add("comment");
    else if (f.state !== "proposed") add(f.state);
    if (f.thread?.length) add("thread");
  }
  return counts.size ? [...counts].map(([label, n]) => `${n} ${label}`).join(", ") : null;
}

function passSummary(history: ReviewHistory, findings: FindingRecord[], resolved: ResolvedFinding[], threads: number): string {
  const live = findings.filter((f) => f.verdict?.verdict !== "drop");
  const open = live.filter((f) => f.previousId !== undefined).length;
  const fresh = live.length - open;
  const since = history.previousHead ? ` since ${history.previousHead.slice(0, 7)}` : "";
  const carried = history.previousHead ? [`${resolved.length} resolved`, `${open} still open`] : [];
  return [`Pass ${history.pass}${since}`, ...carried, `${fresh} new`, `read ${threads} thread${threads === 1 ? "" : "s"}`].join(" · ");
}

function printReport(findings: FindingRecord[], { score, byCategory }: Score) {
  const live = findings.filter((f) => f.verdict?.verdict !== "drop");
  const dropped = findings.length - live.length;
  printFindings(live.filter((f) => !f.general));
  const notes = live.filter((f) => f.general);
  if (notes.length) {
    p.log.step("General notes (outside the diff)");
    printFindings(notes);
  }
  if (dropped) p.log.info(`${dropped} dropped by verify`);
  const breakdown = Object.entries(byCategory)
    .filter(([, points]) => points > 0)
    .map(([category, points]) => `${category} -${points}`);
  p.log.message(`Score ${score}/100${breakdown.length ? ` · ${breakdown.join(" · ")}` : ""}`);
}

function printFindings(findings: FindingRecord[]) {
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
