import type { RunFile } from "../../src/run/run";
import type { Score } from "../../src/review/score";
import type { RepoLinks } from "../../src/git/remote";
import type { FindingRecord } from "../../src/schemas";

export type { FindingRecord, RepoLinks, Score };

export type RunView = RunFile & { threads?: boolean; repo?: RepoLinks | null };

const token = new URL(location.href).searchParams.get("token") ?? "";

export const eventsUrl = `/api/events?token=${encodeURIComponent(token)}`;

export interface FindingResponse {
  finding: FindingRecord;
  score: Score;
  note?: string;
  text?: string;
  headMoved?: boolean | null;
}

export interface HeadStatus {
  reviewedSha: string;
  currentSha: string;
  moved: boolean;
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer ${token}`, ...(body !== undefined && { "content-type": "application/json" }) },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(data.error ?? `Request failed with ${response.status}`);
  return data as T;
}

const post = (id: string, action: string, body: unknown = {}) =>
  call<FindingResponse>(`/api/findings/${encodeURIComponent(id)}/${action}`, body);

export const api = {
  run: () => call<RunView>("/api/run"),
  head: () => call<HeadStatus>("/api/head"),
  accept: (id: string) => post(id, "accept"),
  dismiss: (id: string, reason: string) => post(id, "dismiss", { reason }),
  reset: (id: string) => post(id, "reset"),
  edit: (id: string, change: { body?: string; suggestion?: string }) => post(id, "edit", change),
  copy: (id: string) => post(id, "copy"),
  ask: (id: string, message: string) => post(id, "thread", { message }),
  applyProposal: (id: string) => post(id, "proposal/apply"),
  ignoreProposal: (id: string) => post(id, "proposal/ignore"),
  comment: (comment: { file: string; startLine: number; endLine: number; body: string }) =>
    call<FindingResponse>("/api/comments", comment),
};
