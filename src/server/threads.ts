import { parseAgentJson } from "../agent/json.js";
import { type AgentResult, runAgent } from "../agent/runAgent.js";
import { summarizeError } from "../errors.js";
import { ledgerEntry } from "../run/ledger.js";
import { type FindingRecord, ThreadReply } from "../schemas.js";
import { HttpError } from "./http.js";
import type { RunStore } from "./store.js";
import { applyRevision, assertLive, isLive } from "./transitions.js";

const REPLY_SHAPE = `{
  "reply": "your answer to the user",
  "revision": {
    "severity": "blocking" | "major" | "minor" | "nit",
    "body": "the new comment text",
    "suggestion": "the new replacement for startLine..endLine, or an empty string to remove it",
    "withdraw": true
  }
}`;

function threadPrompt(f: FindingRecord, message: string): string {
  const current = {
    id: f.id,
    state: f.state,
    ruleId: f.ruleId,
    category: f.category,
    severity: f.severity,
    confidence: f.confidence,
    file: f.file,
    startLine: f.startLine,
    endLine: f.endLine,
    title: f.title,
    body: f.body,
    suggestion: f.suggestion,
    evidence: f.evidence,
  };
  return [
    `The user is asking about finding ${f.id} from your review of this merge request. The finding as it stands now (the user may have edited it):`,
    JSON.stringify(current, null, 2),
    "The user's message:",
    message,
    "Answer the message. Check the code again if the question needs it.",
    "Add `revision` only if the finding itself should change: omit the fields you leave as they are, or set `withdraw` to true if on reflection it should not be raised at all.",
    `The lines stay ${f.startLine}-${f.endLine} of ${f.file}. A revised \`suggestion\` replaces all of those lines, so it must contain every line that should remain there, not only the changed one.`,
    "Answer with only a JSON object of this shape, no prose:",
    REPLY_SHAPE,
  ].join("\n");
}

export class ThreadRunner {
  private queue: Promise<void> = Promise.resolve();
  private waiting = new Map<string, number>();

  constructor(
    private readonly store: RunStore,
    private readonly cwd: string | undefined,
    private readonly model?: string,
  ) {}

  get enabled(): boolean {
    return this.cwd !== undefined;
  }

  async submit(id: string, message: string): Promise<FindingRecord> {
    if (!this.enabled) throw new HttpError(409, "the reviewed commit is gone (force-pushed), threads are unavailable");
    await this.store.update(id, (f) => {
      assertLive(f, "ask about");
      (f.thread ??= []).push({ role: "user", text: message, at: new Date().toISOString() });
      f.pending = true;
    });
    this.waiting.set(id, (this.waiting.get(id) ?? 0) + 1);
    this.store.emit({ type: "thread.pending", data: { id } });
    this.queue = this.queue.then(() => this.answer(id, message));
    return this.store.find(id);
  }

  private async call(id: string, prompt: string, sessionId: string): Promise<AgentResult> {
    const result = await runAgent(prompt, { cwd: this.cwd as string, model: this.model, mode: "ask", sessionId });
    await this.store.mutate((run) => run.ledger.push({ ...ledgerEntry("thread", result, this.model), findingId: id }));
    return result;
  }

  private async ask(id: string, message: string): Promise<ThreadReply> {
    const first = await this.call(id, threadPrompt(this.store.find(id), message), this.store.run.sessionId);
    const parsed = parseAgentJson(first.result, ThreadReply);
    if (parsed.ok) return parsed.value;

    const retry = await this.call(
      id,
      `Your answer did not validate: ${parsed.error}\nAnswer again with only the JSON object, no prose.`,
      first.session_id,
    );
    const reparsed = parseAgentJson(retry.result, ThreadReply);
    if (!reparsed.ok) throw new HttpError(502, `Reply didn't validate after a retry: ${reparsed.error}`);
    return reparsed.value;
  }

  private async answer(id: string, message: string): Promise<void> {
    let reply: ThreadReply | undefined;
    let error: ReturnType<typeof summarizeError> | undefined;
    try {
      reply = await this.ask(id, message);
    } catch (err) {
      error = summarizeError(err);
    }

    const left = (this.waiting.get(id) ?? 1) - 1;
    this.waiting.set(id, left);
    await this.store
      .update(id, (f) => {
        const at = new Date().toISOString();
        if (left === 0) delete f.pending;
        if (!reply) {
          (f.thread ??= []).push({ role: "agent", text: "", at, error: error?.message });
          return;
        }
        const revision = reply.revision;
        const changes = revision && Object.values(revision).some((v) => v !== undefined);
        const proposal = changes && isLive(f) && f.state !== "proposed" ? { ...revision, status: "open" as const } : undefined;
        (f.thread ??= []).push({ role: "agent", text: reply.reply, at, ...(proposal && { proposal }) });
        if (changes && isLive(f) && f.state === "proposed") applyRevision(f, revision, at, false);
      })
      .catch((err) => {
        error ??= summarizeError(err);
      });
    if (error) this.store.emit({ type: "thread.error", data: { id, error: error.message } });
  }
}
