import { readFile, rename, writeFile } from "node:fs/promises";
import type { Score } from "../review/score.js";
import { scoreFindings } from "../review/score.js";
import type { RunFile } from "../run/run.js";
import type { FindingRecord } from "../schemas.js";
import { HttpError } from "./http.js";

export type ServerEvent =
  | { type: "finding.updated"; data: { finding: FindingRecord; score: Score } }
  | { type: "thread.pending"; data: { id: string } }
  | { type: "thread.error"; data: { id: string; error: string } };

type Listener = (event: ServerEvent) => void;

export class RunStore {
  private queue: Promise<unknown> = Promise.resolve();
  private listeners = new Set<Listener>();

  private constructor(
    readonly run: RunFile,
    private readonly file: string,
  ) {}

  static async load(file: string): Promise<RunStore> {
    const run = JSON.parse(await readFile(file, "utf8")) as RunFile;
    for (const f of run.findings) delete f.pending;
    return new RunStore(run, file);
  }

  find(id: string): FindingRecord {
    const finding = this.run.findings.find((f) => f.id === id);
    if (!finding) throw new HttpError(404, `No finding ${id}`);
    return finding;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: ServerEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  mutate<T>(change: (run: RunFile) => T): Promise<T> {
    const result = this.queue.then(async () => {
      const value = change(this.run);
      this.run.score = scoreFindings(this.run.findings, this.run.rules);
      const temp = `${this.file}.tmp`;
      await writeFile(temp, `${JSON.stringify(this.run, null, 2)}\n`);
      await rename(temp, this.file);
      return value;
    });
    this.queue = result.catch(() => {});
    return result;
  }

  async update<T>(id: string, change: (finding: FindingRecord, run: RunFile) => T): Promise<T> {
    const value = await this.mutate((run) => change(this.find(id), run));
    this.emit({ type: "finding.updated", data: { finding: this.find(id), score: this.run.score } });
    return value;
  }
}
