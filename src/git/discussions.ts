import { z } from "zod";
import { exec } from "../exec.js";
import { hostFailure } from "./errors.js";
import type { Platform } from "./host.js";

export interface DiscussionNote {
  author: string;
  body: string;
  createdAt: string;
}

export interface Discussion {
  id: string;
  resolved?: boolean;
  file?: string;
  line?: number;
  commitSha?: string;
  notes: DiscussionNote[];
}

const GitLabNote = z.object({
  system: z.boolean(),
  body: z.string(),
  author: z.object({ username: z.string() }),
  created_at: z.string(),
  resolvable: z.boolean().optional(),
  resolved: z.boolean().optional(),
  position: z
    .object({
      new_path: z.string().nullish(),
      new_line: z.int().nullish(),
      old_path: z.string().nullish(),
      old_line: z.int().nullish(),
      head_sha: z.string().nullish(),
    })
    .nullish(),
});

const GitLabThread = z.object({ id: z.string(), notes: z.array(GitLabNote) });

const GitHubLogin = z.object({ login: z.string() }).nullish();

const GitHubLineComment = z.object({
  id: z.number(),
  in_reply_to_id: z.number().nullish(),
  path: z.string(),
  line: z.int().nullish(),
  original_line: z.int().nullish(),
  commit_id: z.string().nullish(),
  user: GitHubLogin,
  body: z.string(),
  created_at: z.string(),
});

const GitHubReview = z.object({
  id: z.number(),
  user: GitHubLogin,
  body: z.string().nullish(),
  submitted_at: z.string().nullish(),
  commit_id: z.string().nullish(),
});

const GitHubIssueComment = z.object({
  id: z.number(),
  user: GitHubLogin,
  body: z.string(),
  created_at: z.string(),
});

export async function fetchDiscussions(platform: Platform, id: number, cwd: string): Promise<Discussion[]> {
  return platform === "gitlab" ? fetchGitLab(id, cwd) : fetchGitHub(id, cwd);
}

async function fetchGitLab(id: number, cwd: string): Promise<Discussion[]> {
  const path = `projects/:id/merge_requests/${id}/discussions`;
  const threads = z.array(GitLabThread).parse(await paged("glab", ["api", "--paginate", path], id, cwd));
  return threads.flatMap((thread) => {
    const notes = thread.notes.filter((n) => !n.system);
    if (!notes.length) return [];
    const position = notes[0]?.position;
    const resolvable = notes.filter((n) => n.resolvable);
    return [
      {
        id: thread.id,
        resolved: resolvable.length ? resolvable.every((n) => n.resolved === true) : undefined,
        file: position?.new_path ?? position?.old_path ?? undefined,
        line: position?.new_line ?? position?.old_line ?? undefined,
        commitSha: position?.head_sha ?? undefined,
        notes: notes.map((n) => ({ author: n.author.username, body: n.body, createdAt: n.created_at })),
      },
    ];
  });
}

async function fetchGitHub(id: number, cwd: string): Promise<Discussion[]> {
  const base = `repos/{owner}/{repo}/pulls/${id}`;
  const [lineComments, reviews, issueComments] = await Promise.all([
    paged("gh", ["api", "--paginate", `${base}/comments`], id, cwd).then((v) => z.array(GitHubLineComment).parse(v)),
    paged("gh", ["api", "--paginate", `${base}/reviews`], id, cwd).then((v) => z.array(GitHubReview).parse(v)),
    paged("gh", ["api", "--paginate", `repos/{owner}/{repo}/issues/${id}/comments`], id, cwd).then((v) =>
      z.array(GitHubIssueComment).parse(v),
    ),
  ]);

  const toNote = (c: { user?: { login: string } | null; body: string; created_at: string }): DiscussionNote => ({
    author: c.user?.login ?? "ghost",
    body: c.body,
    createdAt: c.created_at,
  });

  const roots = lineComments.filter((c) => c.in_reply_to_id == null);
  const rootIds = new Set(roots.map((c) => c.id));
  const threads: Discussion[] = roots.map((root) => ({
    id: `c${root.id}`,
    file: root.path,
    line: root.line ?? root.original_line ?? undefined,
    commitSha: root.commit_id ?? undefined,
    notes: [root, ...lineComments.filter((c) => c.in_reply_to_id === root.id)]
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map(toNote),
  }));
  const orphans = lineComments.filter((c) => c.in_reply_to_id != null && !rootIds.has(c.in_reply_to_id));
  threads.push(...orphans.map((c) => ({ id: `c${c.id}`, file: c.path, line: c.line ?? c.original_line ?? undefined, commitSha: c.commit_id ?? undefined, notes: [toNote(c)] })));

  const reviewThreads: Discussion[] = reviews
    .filter((r) => r.body?.trim())
    .map((r) => ({
      id: `r${r.id}`,
      commitSha: r.commit_id ?? undefined,
      notes: [{ author: r.user?.login ?? "ghost", body: r.body ?? "", createdAt: r.submitted_at ?? "" }],
    }));
  const issueThreads: Discussion[] = issueComments.map((c) => ({ id: `i${c.id}`, notes: [toNote(c)] }));
  return [...threads, ...reviewThreads, ...issueThreads];
}

async function paged(bin: string, args: string[], mrId: number, cwd: string): Promise<unknown[]> {
  const run = await exec(bin, args, { cwd, timeoutMs: 120_000 });
  if (run.code !== 0) throw hostFailure(bin, run, mrId);
  return splitPages(run.stdout).flatMap((page) => JSON.parse(page) as unknown[]);
}

function splitPages(text: string): string[] {
  const pages: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === "[") {
      if (depth === 0) start = i;
      depth++;
    } else if (char === "]" && depth > 0) {
      depth--;
      if (depth === 0) pages.push(text.slice(start, i + 1));
    }
  }
  return pages;
}
