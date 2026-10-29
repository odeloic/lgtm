import { useCallback, useEffect, useMemo, useState } from "react";
import { type FindingRecord, type FindingResponse, type HeadStatus, type RunView, api, eventsUrl } from "./api";
import { type Actions, Context, type Ctx } from "./ctx";
import { type DiffFile, newSideEnd, newSideStart, oldSideAt, parseDiff } from "./diff";
import { DiffFileView, type Selection } from "./DiffView";
import { Finding } from "./Finding";
import {
  ALWAYS_SHOWN_SEVERITIES,
  ALWAYS_SHOWN_STATES,
  SEVERITIES,
  SEVERITY_LABEL,
  STATE_FILTERS,
  type SeverityFilter,
  type StateFilter,
  matches,
  plural,
} from "./format";
import { Header, TopBar } from "./Header";
import { Icon } from "./Icon";
import { Rail } from "./Rail";

interface Toast {
  id: number;
  kind: "info" | "error";
  text: string;
}

const SEVERITY_FILTERS: [SeverityFilter, string][] = [["all", "Any severity"], ...SEVERITIES.map((s): [SeverityFilter, string] => [s, SEVERITY_LABEL[s]])];

function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  count,
  alwaysShown,
}: {
  label: string;
  options: readonly (readonly [T, string])[];
  value: T;
  onChange: (value: T) => void;
  count?: (value: T) => number | null;
  alwaysShown: ReadonlySet<T>;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([option, text]) => {
        const n = count?.(option) ?? null;
        if (!alwaysShown.has(option) && option !== value && n === 0) return null;
        return (
          <button key={option} className={option === value ? "on" : undefined} aria-pressed={option === value} onClick={() => onChange(option)}>
            {text}
            {n !== null && <small>{n}</small>}
          </button>
        );
      })}
    </div>
  );
}

const fileAnchor = (index: number) => `file-${index}`;

async function hex(algorithm: "SHA-1" | "SHA-256", text: string): Promise<string> {
  const bytes = await crypto.subtle.digest(algorithm, new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

function sourceUrl(run: RunView, diffFile: DiffFile | undefined, pathHash: string | undefined, file: string, start: number, end: number): string | undefined {
  if (!run.repo) return undefined;
  const oldNo = diffFile && oldSideAt(diffFile, start);
  if (pathHash && oldNo !== undefined) {
    return run.platform === "gitlab"
      ? `${run.repo.mrUrl}/diffs#${pathHash}_${oldNo}_${start}`
      : `${run.repo.mrUrl}/files#diff-${pathHash}R${start}${end > start ? `-R${end}` : ""}`;
  }
  const sha = run.mr.headSha;
  return run.platform === "gitlab"
    ? `${run.repo.url}/-/blob/${sha}/${file}#L${start}-${end}`
    : `${run.repo.url}/blob/${sha}/${file}#L${start}-L${end}`;
}

async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    document.body.append(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

export function App() {
  const [run, setRun] = useState<RunView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [head, setHead] = useState<HeadStatus | null>(null);
  const [pendingSince, setPendingSince] = useState<Record<string, number>>({});
  const [threadErrors, setThreadErrors] = useState<Record<string, string>>({});
  const [postErrors, setPostErrors] = useState<Record<string, string>>({});
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [stateFilter, setStateFilter] = useState<StateFilter>("all");
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [selection, setSelection] = useState<Selection | null>(null);

  const notify = useCallback((text: string, kind: Toast["kind"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((all) => [...all, { id, kind, text }]);
    setTimeout(() => setToasts((all) => all.filter((t) => t.id !== id)), kind === "error" ? 8000 : 4000);
  }, []);

  const apply = useCallback((finding: FindingResponse["finding"], score: FindingResponse["score"]) => {
    setRun((current) => {
      if (!current) return current;
      const exists = current.findings.some((f) => f.id === finding.id);
      const findings = exists ? current.findings.map((f) => (f.id === finding.id ? finding : f)) : [...current.findings, finding];
      return { ...current, findings, score };
    });
    setPendingSince((all) => {
      if (finding.pending) return finding.id in all ? all : { ...all, [finding.id]: Date.now() };
      if (!(finding.id in all)) return all;
      const { [finding.id]: _, ...rest } = all;
      return rest;
    });
  }, []);

  useEffect(() => {
    api.run().then(setRun, (e: Error) => setLoadError(e.message));
    api.head().then(setHead, () => setHead(null));
  }, []);

  const loaded = run !== null;
  useEffect(() => {
    if (!loaded) return;
    const source = new EventSource(eventsUrl);
    source.addEventListener("finding.updated", (e) => {
      const { finding, score } = JSON.parse((e as MessageEvent<string>).data) as FindingResponse;
      apply(finding, score);
    });
    source.addEventListener("thread.error", (e) => {
      const { id, error } = JSON.parse((e as MessageEvent<string>).data) as { id: string; error: string };
      setThreadErrors((all) => ({ ...all, [id]: error }));
    });
    return () => source.close();
  }, [loaded, apply]);

  const actions = useMemo<Actions>(() => {
    const guard = async (work: () => Promise<FindingResponse>, after?: (r: FindingResponse) => void | Promise<void>) => {
      try {
        const response = await work();
        apply(response.finding, response.score);
        if (response.note) notify(response.note);
        await after?.(response);
        return true;
      } catch (err) {
        notify((err as Error).message, "error");
        return false;
      }
    };
    return {
      accept: (id) => guard(() => api.accept(id)),
      dismiss: (id, reason) => guard(() => api.dismiss(id, reason)),
      reset: (id) => guard(() => api.reset(id)),
      edit: (id, change) => guard(() => api.edit(id, change)),
      copy: async (id) => {
        try {
          const { text, headMoved } = await api.copy(id);
          const ok = text !== undefined && (await writeClipboard(text));
          notify(ok ? "Copied to the clipboard." : "Could not write to the clipboard.", ok ? "info" : "error");
          if (headMoved) notify("The merge request has moved since this review, line numbers may have shifted.", "error");
          return ok;
        } catch (err) {
          notify((err as Error).message, "error");
          return false;
        }
      },
      postComment: async (id) => {
        setPostErrors(({ [id]: _, ...rest }) => rest);
        try {
          const response = await api.postComment(id);
          apply(response.finding, response.score);
          if (response.note) notify(response.note);
          return true;
        } catch (err) {
          setPostErrors((all) => ({ ...all, [id]: (err as Error).message }));
          return false;
        }
      },
      copyText: async (text) => {
        const ok = await writeClipboard(text);
        notify(ok ? "Copied to the clipboard." : "Could not write to the clipboard.", ok ? "info" : "error");
        return ok;
      },
      ask: (id, message) => {
        setThreadErrors(({ [id]: _, ...rest }) => rest);
        return guard(() => api.ask(id, message));
      },
      applyProposal: (id) => guard(() => api.applyProposal(id)),
      ignoreProposal: (id) => guard(() => api.ignoreProposal(id)),
      comment: (comment) => guard(() => api.comment(comment)),
    };
  }, [apply, notify]);

  const files = useMemo<DiffFile[]>(() => (run ? parseDiff(run.diff) : []), [run?.diff]);
  const [pathHashes, setPathHashes] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!run) return;
    const algorithm = run.platform === "gitlab" ? "SHA-1" : "SHA-256";
    let current = true;
    Promise.all(files.map(async (f) => [f.path, await hex(algorithm, f.path)] as const)).then((pairs) => {
      if (current) setPathHashes(Object.fromEntries(pairs));
    });
    return () => {
      current = false;
    };
  }, [files, run?.platform]);

  const ctx = useMemo<Ctx>(
    () => ({
      actions,
      pendingSince,
      threadErrors,
      postErrors,
      threads: run?.threads ?? true,
      lineText: (file, newNo) => files.find((f) => f.path === file)?.hunks.flatMap((h) => h.lines).find((l) => l.newNo === newNo)?.text,
      fileAnchor: (file) => {
        const index = files.findIndex((f) => f.path === file);
        return index === -1 ? undefined : fileAnchor(index);
      },
      sourceUrl: (file, start, end) =>
        run ? sourceUrl(run, files.find((f) => f.path === file), pathHashes[file], file, start, end) : undefined,
    }),
    [actions, pendingSince, threadErrors, postErrors, files, pathHashes, run?.threads, run?.repo, run?.mr.headSha, run?.platform],
  );

  if (loadError) {
    return (
      <main className="state">
        <Icon name="triangle-alert" />
        <p>{loadError}</p>
      </main>
    );
  }
  if (!run) {
    return (
      <main className="state">
        <Icon name="loader" spin />
        <p>Loading the review</p>
      </main>
    );
  }

  const placed = (f: FindingRecord) =>
    !f.general && files.some((file) => file.path === f.file && file.hunks.some((h) => f.endLine >= newSideStart(h) && f.endLine <= newSideEnd(h)));
  const visible = run.findings.filter((f) => matches(f, stateFilter, severityFilter));
  const inFile = (file: DiffFile) => visible.filter((f) => placed(f) && f.file === file.path).sort((a, b) => a.endLine - b.endLine);
  const general = visible.filter((f) => !placed(f));
  const ordered = [...files.flatMap(inFile), ...general];

  return (
    <Context.Provider value={ctx}>
      <div className="page">
        <TopBar run={run} />
        <Header run={run} head={head} />
        <div className="tb">
          <Segmented
            label="State"
            options={STATE_FILTERS}
            value={stateFilter}
            onChange={setStateFilter}
            count={(s) => run.findings.filter((f) => matches(f, s, severityFilter)).length}
            alwaysShown={ALWAYS_SHOWN_STATES}
          />
          <Segmented
            label="Severity"
            options={SEVERITY_FILTERS}
            value={severityFilter}
            onChange={setSeverityFilter}
            count={(s) => (s === "all" ? null : run.findings.filter((f) => matches(f, stateFilter, s)).length)}
            alwaysShown={ALWAYS_SHOWN_SEVERITIES}
          />
          <span className="tb-note">
            Showing {visible.length} of {plural(run.findings.length, "finding")} in {plural(files.length, "file")}
          </span>
        </div>
        <div className="layout">
          <div className="main">
            {files.map((file, i) => (
              <DiffFileView
                key={file.path}
                file={file}
                anchor={fileAnchor(i)}
                findings={inFile(file)}
                selection={selection}
                setSelection={setSelection}
              />
            ))}
            {general.length > 0 && (
              <section className="general" aria-label="General notes">
                <h2>General notes</h2>
                {general.map((f) => (
                  <Finding key={f.id} f={f} />
                ))}
              </section>
            )}
            {visible.length === 0 && <p className="empty">No findings match these filters.</p>}
          </div>
          <Rail ordered={ordered} files={files} anchorOf={(file) => fileAnchor(files.indexOf(file))} countIn={(file) => inFile(file).length} />
        </div>
      </div>
      <div className="toasts" role="status">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <Icon name={t.kind === "error" ? "triangle-alert" : "circle-check"} />
            {t.text}
          </div>
        ))}
      </div>
    </Context.Provider>
  );
}
