import { z } from "zod";
import { exec } from "../exec.js";
import { summarizeError } from "../errors.js";
import { hostFailure } from "./errors.js";
import type { Platform } from "./host.js";
import type { CiJob, CiJobStatus, CiState, CiStatus } from "./ciStatus.js";

const GitHubCheckRuns = z.object({
  check_runs: z.array(z.object({ name: z.string(), status: z.string(), conclusion: z.string().nullable() })),
});
const GitHubCombinedStatus = z.object({
  statuses: z.array(z.object({ context: z.string(), state: z.string() })),
});
const GitLabMr = z.object({ head_pipeline: z.object({ id: z.number(), status: z.string() }).nullable().optional() });
const GitLabBridges = z.array(
  z.object({
    name: z.string(),
    status: z.string(),
    allow_failure: z.boolean().optional(),
    downstream_pipeline: z.object({ status: z.string() }).nullable().optional(),
  }),
);
const GitLabPipelines = z.array(z.object({ id: z.number(), sha: z.string() }));
const GitLabJobs = z.array(z.object({ name: z.string(), status: z.string(), allow_failure: z.boolean().optional() }));

export async function fetchCi(platform: Platform, mrId: number, headSha: string, cwd: string): Promise<CiStatus> {
  try {
    const jobs = platform === "gitlab" ? await gitlabJobs(mrId, cwd) : await githubJobs(mrId, headSha, cwd);
    if (jobs.staleSha !== undefined) return { state: "stale", sha: headSha, jobs: jobs.jobs, staleSha: jobs.staleSha };
    return { state: overallState(jobs.jobs), sha: headSha, jobs: jobs.jobs };
  } catch (err) {
    return { state: "none", sha: headSha, jobs: [], warning: `Couldn't fetch CI for ${headSha.slice(0, 7)}: ${summarizeError(err).message}` };
  }
}

function overallState(jobs: CiJob[]): CiState {
  if (jobs.some((j) => j.status === "failed" || j.status === "canceled")) return "failed";
  if (jobs.some((j) => j.status === "running" || j.status === "pending")) return "running";
  return jobs.some((j) => j.status === "passed" || j.status === "allowed_failure") ? "passed" : "none";
}

async function githubJobs(mrId: number, sha: string, cwd: string): Promise<{ jobs: CiJob[]; staleSha?: string }> {
  const runs = GitHubCheckRuns.parse(await api("gh", `repos/{owner}/{repo}/commits/${sha}/check-runs?per_page=100`, mrId, cwd));
  const combined = GitHubCombinedStatus.parse(await api("gh", `repos/{owner}/{repo}/commits/${sha}/status?per_page=100`, mrId, cwd));
  return {
    jobs: [
      ...runs.check_runs.map((r) => ({ name: r.name, status: githubCheckStatus(r.status, r.conclusion) })),
      ...combined.statuses.map((s) => ({ name: s.context, status: githubStatusState(s.state) })),
    ],
  };
}

function githubCheckStatus(status: string, conclusion: string | null): CiJobStatus {
  if (status === "in_progress") return "running";
  if (status !== "completed") return "pending";
  if (conclusion === "success") return "passed";
  if (conclusion === "skipped" || conclusion === "neutral") return "skipped";
  if (conclusion === "cancelled") return "canceled";
  if (conclusion === "action_required") return "manual";
  return "failed";
}

function githubStatusState(state: string): CiJobStatus {
  if (state === "success") return "passed";
  if (state === "pending") return "pending";
  return "failed";
}

async function gitlabJobs(mrId: number, cwd: string): Promise<{ jobs: CiJob[]; staleSha?: string }> {
  const mr = GitLabMr.parse(await api("glab", `projects/:id/merge_requests/${mrId}`, mrId, cwd));
  if (!mr.head_pipeline) {
    const pipelines = GitLabPipelines.parse(await api("glab", `projects/:id/merge_requests/${mrId}/pipelines`, mrId, cwd));
    const latest = pipelines[0];
    return latest ? { jobs: [], staleSha: latest.sha } : { jobs: [] };
  }
  const { id, status } = mr.head_pipeline;
  const jobs = GitLabJobs.parse(await api("glab", `projects/:id/pipelines/${id}/jobs?per_page=100`, mrId, cwd));
  const bridges = GitLabBridges.parse(await api("glab", `projects/:id/pipelines/${id}/bridges?per_page=100`, mrId, cwd));
  const mapped: CiJob[] = [
    ...jobs.map((j) => ({ name: j.name, status: gitlabJobStatus(j.status, j.allow_failure === true) })),
    ...bridges.map((b) => ({ name: b.name, status: gitlabJobStatus(b.downstream_pipeline?.status ?? b.status, b.allow_failure === true) })),
  ];
  return { jobs: mapped.length ? mapped : [{ name: "pipeline", status: gitlabJobStatus(status, false) }] };
}

function gitlabJobStatus(status: string, allowFailure: boolean): CiJobStatus {
  if (status === "success") return "passed";
  if (status === "failed") return allowFailure ? "allowed_failure" : "failed";
  if (status === "running") return "running";
  if (status === "canceled" || status === "canceling") return "canceled";
  if (status === "skipped") return "skipped";
  if (status === "manual") return "manual";
  return "pending";
}

async function api(bin: string, path: string, mrId: number, cwd: string): Promise<unknown> {
  const result = await exec(bin, ["api", path], { cwd, timeoutMs: 30_000 });
  if (result.code !== 0) throw hostFailure(bin, result, mrId);
  return JSON.parse(result.stdout);
}
