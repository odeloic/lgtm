import { type Context, Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { HostError } from "../git/errors.js";
import { fetchMergeRequest } from "../git/mr.js";
import { postComment } from "../git/post.js";
import { getRemote, repoLinks } from "../git/remote.js";
import { readProjectConfig } from "../project.js";
import { clampToHunk, newSideRanges, oldLineOf } from "../review/anchor.js";
import type { FindingRecord } from "../schemas.js";
import { hostGuard, tokenGuard } from "./access.js";
import { commentBody, copyText } from "./copy.js";
import { HttpError, parseBody } from "./http.js";
import { readAsset, readIndex } from "./static.js";
import type { RunStore, ServerEvent } from "./store.js";
import type { ThreadRunner } from "./threads.js";
import * as transition from "./transitions.js";

export interface AppOptions {
  store: RunStore;
  threads: ThreadRunner;
  repoRoot: string;
  token: string;
  allowedHosts: Set<string>;
}

const EditBody = z.object({ body: z.string().optional(), suggestion: z.string().optional() });
const DismissBody = z.object({ reason: z.string().trim().min(1) });
const ThreadBody = z.object({ message: z.string().trim().min(1) });
const CommentBody = z
  .object({
    file: z.string().min(1),
    startLine: z.int().positive(),
    endLine: z.int().positive(),
    body: z.string().trim().min(1),
    suggestion: z.string().optional(),
  })
  .refine((c) => c.startLine <= c.endLine, { message: "startLine must not be after endLine", path: ["startLine"] });

const isApiOrRoot = (path: string) => path === "/" || path.startsWith("/api/");

export function createApp({ store, threads, repoRoot, token, allowedHosts }: AppOptions): Hono {
  const app = new Hono();
  const respond = (f: FindingRecord, extra: object = {}) => ({ finding: f, score: store.run.score, ...extra });
  const repo = (async () => {
    const config = await readProjectConfig(repoRoot).catch(() => null);
    const remote = await getRemote(repoRoot, config?.remote ?? "origin");
    return remote ? repoLinks(remote, store.run.platform, store.run.mr.id) : null;
  })();

  const checkHead = async () => {
    const { mr, platform } = store.run;
    const current = await fetchMergeRequest(platform, mr.id, repoRoot);
    return { reviewedSha: mr.headSha, currentSha: current.headSha, moved: current.headSha !== mr.headSha };
  };

  const resolveProposal = (action: "applied" | "ignored") => async (c: Context) => {
    const f = await store.update(c.req.param("id") ?? "", (f) => {
      transition.assertLive(f, action === "applied" ? "apply a proposal to" : "ignore a proposal on");
      const proposal = [...(f.thread ?? [])].reverse().find((m) => m.proposal?.status === "open")?.proposal;
      if (!proposal) throw new HttpError(409, `${f.id} has no open proposal`);
      const { status: _, ...revision } = proposal;
      proposal.status = action;
      if (action === "applied") transition.applyRevision(f, revision, new Date().toISOString(), true);
      return f;
    });
    return c.json(respond(f));
  };

  app.use(hostGuard(allowedHosts));
  app.use(tokenGuard(token, (path) => !isApiOrRoot(path)));
  app.onError((err, c) => c.json({ error: err.message }, err instanceof HttpError ? err.status : err instanceof HostError ? 502 : 500));
  app.notFound((c) => c.json({ error: "Not found" }, 404));

  app.get("/", async (c) => {
    const index = await readIndex();
    return c.body(index.body, 200, { "content-type": index.type });
  });

  app.get("/api/run", async (c) => c.json({ ...store.run, threads: threads.enabled, repo: await repo }));

  app.get("/api/head", async (c) => {
    try {
      return c.json(await checkHead());
    } catch (err) {
      throw new HttpError(502, `Couldn't read the current head: ${(err as Error).message}`);
    }
  });

  app.post("/api/findings/:id/edit", async (c) => {
    const change = await parseBody(c.req.raw, EditBody);
    const f = await store.update(c.req.param("id"), (f) => (transition.edit(f, change), f));
    return c.json(respond(f));
  });

  app.post("/api/findings/:id/accept", async (c) => {
    const f = await store.update(c.req.param("id"), (f) => (transition.accept(f), f));
    return c.json(respond(f, { note: transition.overrideNote(f) }));
  });

  app.post("/api/findings/:id/dismiss", async (c) => {
    const { reason } = await parseBody(c.req.raw, DismissBody);
    const f = await store.update(c.req.param("id"), (f) => (transition.dismiss(f, reason), f));
    return c.json(respond(f));
  });

  app.post("/api/findings/:id/reset", async (c) => {
    const f = await store.update(c.req.param("id"), (f) => (transition.reset(f), f));
    return c.json(respond(f));
  });

  app.post("/api/findings/:id/copy", async (c) => {
    const id = c.req.param("id");
    transition.assertLive(store.find(id), "copy");
    const headMoved = await checkHead().then(
      (head) => head.moved,
      () => null,
    );
    const text = await store.update(id, (f, run) => copyText(f, run.platform));
    const f = store.find(id);
    return c.json(respond(f, { text, headMoved, note: transition.overrideNote(f) }));
  });

  const diffRanges = newSideRanges(store.run.diff);
  const posting = new Set<string>();
  app.post("/api/findings/:id/post", async (c) => {
    const id = c.req.param("id");
    const f = store.find(id);
    transition.assertPostable(f);
    if (posting.has(id)) throw new HttpError(409, `${id} is already being posted`);
    posting.add(id);
    try {
      const { platform, mr, diff } = store.run;
      const [startLine, endLine] = clampToHunk(diffRanges.get(f.file) ?? [], f.startLine, f.endLine);
      const url = await postComment(platform, mr.id, repoRoot, {
        body: f.general ? copyText(f, platform) : commentBody(f, platform),
        mrUrl: (await repo)?.mrUrl,
        ...(!f.general && {
          anchor: { file: f.file, startLine, endLine, oldLine: oldLineOf(diff, f.file, endLine), headSha: mr.headSha },
        }),
      });
      const posted = await store.update(id, (f) => (transition.markPosted(f, new Date().toISOString(), url), f));
      return c.json(respond(posted, { note: transition.overrideNote(posted) }));
    } finally {
      posting.delete(id);
    }
  });

  app.post("/api/comments", async (c) => {
    const comment = await parseBody(c.req.raw, CommentBody);
    const inDiff = diffRanges.get(comment.file)?.some(([start, end]) => comment.startLine >= start && comment.endLine <= end);
    if (!inDiff) throw new HttpError(400, `${comment.file}:${comment.startLine}-${comment.endLine} is not inside one hunk of the diff`);
    const created = await store.mutate((run) => {
      const next = Math.max(0, ...run.findings.map((x) => Number(/^U(\d+)$/.exec(x.id)?.[1] ?? 0))) + 1;
      const finding: FindingRecord = {
        id: `U${next}`,
        source: "user",
        state: "edited",
        ruleId: null,
        category: "user",
        severity: "nit",
        confidence: "high",
        file: comment.file,
        startLine: comment.startLine,
        endLine: comment.endLine,
        title: comment.body.split("\n")[0]?.slice(0, 80) ?? "",
        body: comment.body,
        ...(comment.suggestion && { suggestion: comment.suggestion }),
        evidence: `${comment.file}:${comment.startLine}`,
      };
      run.findings.push(finding);
      return finding;
    });
    store.emit({ type: "finding.updated", data: { finding: created, score: store.run.score } });
    return c.json(respond(created), 201);
  });

  app.post("/api/findings/:id/thread", async (c) => {
    const { message } = await parseBody(c.req.raw, ThreadBody);
    return c.json(respond(await threads.submit(c.req.param("id"), message)), 202);
  });

  app.post("/api/findings/:id/proposal/apply", resolveProposal("applied"));
  app.post("/api/findings/:id/proposal/ignore", resolveProposal("ignored"));

  app.get("/api/events", (c) =>
    streamSSE(c, async (stream) => {
      const unsubscribe = store.subscribe((event: ServerEvent) => {
        void stream.writeSSE({ event: event.type, data: JSON.stringify(event.data) });
      });
      await new Promise<void>((resolve) => stream.onAbort(resolve));
      unsubscribe();
    }),
  );

  app.get("*", async (c) => {
    const asset = await readAsset(c.req.path);
    if (!asset) throw new HttpError(404, "Not found");
    return c.body(asset.body, 200, { "content-type": asset.type });
  });

  return app;
}
