export type CiState = "passed" | "failed" | "running" | "stale" | "none";

export type CiJobStatus =
  | "passed"
  | "failed"
  | "allowed_failure"
  | "running"
  | "pending"
  | "skipped"
  | "manual"
  | "canceled";

export interface CiJob {
  name: string;
  status: CiJobStatus;
}

export interface CiStatus {
  state: CiState;
  sha: string;
  jobs: CiJob[];
  staleSha?: string;
  warning?: string;
}

const MAX_LISTED_JOBS = 6;

export function ciLabel(ci: CiStatus): string {
  if (ci.state === "none") return "CI: none";
  if (ci.state === "running") return "CI: running";
  if (ci.state === "stale") return `CI: on older commit ${(ci.staleSha ?? "").slice(0, 7)}`;
  if (ci.state === "failed") {
    const failed = ci.jobs.filter((j) => j.status === "failed" || j.status === "canceled");
    return `CI: failed (${failed.map((j) => `${j.name} ✗`).join(" ")})`;
  }
  const passed = ci.jobs.filter((j) => j.status === "passed");
  const shown = passed.slice(0, MAX_LISTED_JOBS).map((j) => `${j.name} ✓`);
  const more = passed.length - shown.length;
  return `CI: passed (${shown.join(" ")}${more > 0 ? ` +${more}` : ""}) @ ${ci.sha.slice(0, 7)}`;
}
