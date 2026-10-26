import { type FormEvent, Fragment, type ReactNode, useState } from "react";
import type { FindingRecord } from "./api";
import { useCtx } from "./ctx";
import { type DiffFile, type DiffLine, newSideEnd, newSideStart } from "./diff";
import { Finding } from "./Finding";
import { basename, dirname, plural } from "./format";

interface Selection {
  file: string;
  start: number;
  end: number;
}

const SIGN = { add: "+", del: "−", ctx: "" } as const;
const FOLD_MIN = 4;

type Item = { kind: "line"; line: DiffLine } | { kind: "fold"; key: string; lines: DiffLine[] };

function Composer({ selection, onDone }: { selection: Selection; onDone: () => void }) {
  const { actions } = useCtx();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const ok = await actions.comment({ file: selection.file, startLine: selection.start, endLine: selection.end, body });
    setBusy(false);
    if (ok) onDone();
  };

  return (
    <form className="composer" onSubmit={submit}>
      <span className="muted">{selection.start === selection.end ? `Line ${selection.start}` : `Lines ${selection.start} to ${selection.end}`}</span>
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder="Write your own comment" autoFocus />
      <div className="row">
        <button className="btn pri" disabled={busy || !body.trim()}>
          Add comment
        </button>
        <button type="button" className="btn" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function Gap({ count, children }: { count: number; children?: ReactNode }) {
  if (count <= 0) return null;
  return (
    <div className="gap">
      {plural(count, "unchanged line")}
      {children}
    </div>
  );
}

function foldLabel(lines: DiffLine[]): string {
  if (lines.every((l) => l.kind === "add")) return `${plural(lines.length, "added line")} without findings`;
  if (lines.every((l) => l.kind === "del")) return `${plural(lines.length, "removed line")} without findings`;
  return `${plural(lines.length, "changed line")} without findings`;
}

function fold(lines: DiffLine[], hunk: number, quiet: (line: DiffLine) => boolean, shown: Set<string>): Item[] {
  const items: Item[] = [];
  let run: DiffLine[] = [];
  let runStart = 0;
  const flush = () => {
    const key = `${hunk}:${runStart}`;
    if (run.length >= FOLD_MIN && !shown.has(key)) items.push({ kind: "fold", key, lines: run });
    else items.push(...run.map((line) => ({ kind: "line" as const, line })));
    run = [];
  };
  lines.forEach((line, i) => {
    if (line.kind !== "ctx" && quiet(line)) {
      if (run.length === 0) runStart = i;
      run.push(line);
      return;
    }
    flush();
    items.push({ kind: "line", line });
  });
  flush();
  return items;
}

export function DiffFileView({
  file,
  anchor,
  findings,
  selection,
  setSelection,
}: {
  file: DiffFile;
  anchor: string;
  findings: FindingRecord[];
  selection: Selection | null;
  setSelection: (s: Selection | null) => void;
}) {
  const [open, setOpen] = useState(true);
  const [shown, setShown] = useState<Set<string>>(new Set());
  const endings = new Map<number, FindingRecord[]>();
  const hunkEnds = file.hunks.map(newSideEnd);
  for (const f of findings) endings.set(f.endLine, [...(endings.get(f.endLine) ?? []), f]);
  const marked = (n: number | null) => n !== null && findings.some((f) => n >= f.startLine && n <= f.endLine);
  const selectedHere = selection?.file === file.path ? selection : null;
  const selected = (n: number | null) => n !== null && selectedHere !== null && n >= selectedHere.start && n <= selectedHere.end;
  const quiet = (line: DiffLine) => !marked(line.newNo) && !selected(line.newNo);

  const pick = (line: DiffLine, shift: boolean) => {
    if (line.newNo === null) return;
    if (shift && selectedHere) {
      setSelection({ file: file.path, start: Math.min(selectedHere.start, line.newNo), end: Math.max(selectedHere.end, line.newNo) });
    } else {
      setSelection({ file: file.path, start: line.newNo, end: line.newNo });
    }
  };

  const numberButton = (line: DiffLine, value: number | null) => (
    <button
      className="no"
      disabled={line.newNo === null}
      onClick={(e) => pick(line, e.shiftKey)}
      aria-label={line.newNo === null ? undefined : `Comment on line ${line.newNo}`}
    >
      {value ?? ""}
    </button>
  );

  const row = (line: DiffLine, key: number | string) => {
    const here = line.newNo === null ? [] : (endings.get(line.newNo) ?? []);
    return (
      <Fragment key={key}>
        <div className={`r ${line.kind}${marked(line.newNo) ? " mk" : ""}${selected(line.newNo) ? " sel" : ""}`}>
          {numberButton(line, line.oldNo)}
          {numberButton(line, line.newNo)}
          <span className="sg">{SIGN[line.kind]}</span>
          <code>{line.text}</code>
        </div>
        {selectedHere && line.newNo === selectedHere.end && (
          <div className="anchor">
            <Composer selection={selectedHere} onDone={() => setSelection(null)} />
          </div>
        )}
        {here.length > 0 && (
          <div className="anchor">
            {here.map((f) => (
              <Finding key={f.id} f={f} />
            ))}
          </div>
        )}
      </Fragment>
    );
  };

  return (
    <section className="file" id={anchor}>
      <header>
        <span className="fpath">
          {file.oldPath && <span>{file.oldPath} → </span>}
          <span>{dirname(file.path)}</span>
          {basename(file.path)}
        </span>
        <span className="sp" />
        <span className="fcount">{findings.length === 0 ? "no findings" : plural(findings.length, "finding")}</span>
        <span className="plus">+{file.added}</span>
        <span className="minus">−{file.removed}</span>
        <button className="btn ghost slim" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? "Collapse" : "Expand"}
        </button>
      </header>
      {open &&
        (file.binary ? (
          <div className="binary">Binary file, no diff to show.</div>
        ) : (
          <div className="diff">
            {file.hunks.map((hunk, h) => {
              const previousEnd = h === 0 ? 0 : (hunkEnds[h - 1] ?? 0);
              return (
                <Fragment key={h}>
                  <Gap count={newSideStart(hunk) - previousEnd - 1} />
                  {fold(hunk.lines, h, quiet, shown).map((item, i) =>
                    item.kind === "line" ? (
                      row(item.line, i)
                    ) : (
                      <div className="gap" key={item.key}>
                        {foldLabel(item.lines)}
                        <button onClick={() => setShown(new Set(shown).add(item.key))}>show</button>
                      </div>
                    ),
                  )}
                </Fragment>
              );
            })}
          </div>
        ))}
    </section>
  );
}

export type { Selection };
