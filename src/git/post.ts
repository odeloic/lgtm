import { z } from "zod";
import { exec } from "../exec.js";
import { hostFailure } from "./errors.js";
import type { Platform } from "./host.js";

export interface LineAnchor {
  file: string;
  startLine: number;
  endLine: number;
  oldLine: number | null;
  headSha: string;
}

export interface NewComment {
  body: string;
  anchor?: LineAnchor;
  mrUrl?: string;
}

const GitLabVersion = z.object({ head_commit_sha: z.string(), base_commit_sha: z.string(), start_commit_sha: z.string() });
const GitLabNote = z.object({ id: z.number() });
const GitLabDiscussion = z.object({ notes: z.array(GitLabNote).min(1) });
const GitHubComment = z.object({ html_url: z.string() });

export async function postComment(platform: Platform, mrId: number, cwd: string, comment: NewComment): Promise<string | undefined> {
  return platform === "gitlab" ? postGitLab(mrId, cwd, comment) : postGitHub(mrId, cwd, comment);
}

async function postGitLab(mrId: number, cwd: string, { body, anchor, mrUrl }: NewComment): Promise<string | undefined> {
  const base = `projects/:id/merge_requests/${mrId}`;
  const noteUrl = (id: number) => (mrUrl ? `${mrUrl}#note_${id}` : undefined);
  if (!anchor) {
    const note = GitLabNote.parse(await api("glab", `${base}/notes`, { body }, mrId, cwd));
    return noteUrl(note.id);
  }
  const versions = z.array(GitLabVersion).parse(await api("glab", `${base}/versions`, undefined, mrId, cwd));
  const version = versions.find((v) => v.head_commit_sha === anchor.headSha);
  if (!version) throw new Error(`!${mrId} has no diff version at ${anchor.headSha.slice(0, 7)}, the commit this review was run on.`);
  const position = {
    position_type: "text",
    base_sha: version.base_commit_sha,
    start_sha: version.start_commit_sha,
    head_sha: version.head_commit_sha,
    old_path: anchor.file,
    new_path: anchor.file,
    new_line: anchor.endLine,
    ...(anchor.oldLine !== null && { old_line: anchor.oldLine }),
  };
  const discussion = GitLabDiscussion.parse(await api("glab", `${base}/discussions`, { body, position }, mrId, cwd));
  return noteUrl(discussion.notes[0]!.id);
}

async function postGitHub(mrId: number, cwd: string, { body, anchor }: NewComment): Promise<string> {
  if (!anchor) {
    return GitHubComment.parse(await api("gh", `repos/{owner}/{repo}/issues/${mrId}/comments`, { body }, mrId, cwd)).html_url;
  }
  const payload = {
    body,
    commit_id: anchor.headSha,
    path: anchor.file,
    side: "RIGHT",
    line: anchor.endLine,
    ...(anchor.startLine !== anchor.endLine && { start_line: anchor.startLine, start_side: "RIGHT" }),
  };
  return GitHubComment.parse(await api("gh", `repos/{owner}/{repo}/pulls/${mrId}/comments`, payload, mrId, cwd)).html_url;
}

async function api(bin: string, path: string, payload: object | undefined, mrId: number, cwd: string): Promise<unknown> {
  const args = payload === undefined ? ["api", path] : ["api", "--method", "POST", path, "--header", "Content-Type: application/json", "--input", "-"];
  const run = await exec(bin, args, { cwd, timeoutMs: 60_000, ...(payload !== undefined && { input: JSON.stringify(payload) }) });
  if (run.code !== 0) throw hostFailure(bin, run, mrId);
  return JSON.parse(run.stdout);
}
