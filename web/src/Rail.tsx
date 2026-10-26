import { useEffect, useRef, useState } from "react";
import type { FindingRecord } from "./api";
import type { DiffFile } from "./diff";
import { SEVERITY_LABEL, STATE_WORD, basename, effectiveStatus, isLive, lineRange } from "./format";

const element = (f: FindingRecord) => document.getElementById(`finding-${f.id}`);
const READING_LINE = 0.4;
const LANDED = 60;

export function Rail({
  ordered,
  files,
  anchorOf,
  countIn,
}: {
  ordered: FindingRecord[];
  files: DiffFile[];
  anchorOf: (file: DiffFile) => string;
  countIn: (file: DiffFile) => number;
}) {
  const [current, setCurrent] = useState<string | null>(null);
  const pinned = useRef<string | null>(null);
  const ids = ordered.map((f) => f.id).join(" ");

  const pin = (id: string) => {
    pinned.current = id;
    setCurrent(id);
  };

  useEffect(() => {
    const update = () => {
      if (pinned.current) return;
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      const line = window.innerHeight * (atBottom ? 1 : READING_LINE);
      let found = ordered[0]?.id ?? null;
      for (const f of ordered) {
        const top = element(f)?.getBoundingClientRect().top;
        if (top !== undefined && top < line) found = f.id;
      }
      setCurrent(found);
    };
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    const unpin = () => {
      pinned.current = null;
    };
    update();
    addEventListener("scroll", onScroll, { passive: true });
    for (const name of ["wheel", "touchmove", "keydown"]) addEventListener(name, unpin, { passive: true });
    return () => {
      removeEventListener("scroll", onScroll);
      for (const name of ["wheel", "touchmove", "keydown"]) removeEventListener(name, unpin);
      cancelAnimationFrame(frame);
    };
  }, [ids]);

  const jump = (direction: 1 | -1) => {
    const at = Math.max(0, ordered.findIndex((f) => f.id === current));
    const top = (ordered[at] && element(ordered[at])?.getBoundingClientRect().top) ?? LANDED;
    const passed = direction === 1 ? top > LANDED + 10 : top < LANDED - 20;
    const notReached = pinned.current !== current && passed;
    const target = ordered[notReached ? at : at + direction];
    if (!target) return;
    element(target)?.scrollIntoView({ behavior: "smooth", block: "start" });
    pin(target.id);
  };

  return (
    <aside className="rail">
      <nav className="index" aria-label="Findings">
        <h2>Findings</h2>
        {ordered.length === 0 ? (
          <p className="muted">No findings match these filters.</p>
        ) : (
          <ol>
            {ordered.map((f) => {
              return (
                <li key={f.id} className={[current === f.id && "cur", !isLive(f) && "closed"].filter(Boolean).join(" ") || undefined}>
                  <a href={`#finding-${f.id}`} onClick={() => pin(f.id)} aria-current={current === f.id ? "location" : undefined}>
                    {f.title}
                  </a>
                  <small>
                    {SEVERITY_LABEL[f.severity]} · {STATE_WORD[effectiveStatus(f)]} · {f.general ? basename(f.file) : ""}:{lineRange(f)}
                  </small>
                </li>
              );
            })}
          </ol>
        )}
        {files.length > 0 && (
          <div className="files">
            {files.map((file) => (
              <a key={file.path} href={`#${anchorOf(file)}`} title={file.path}>
                {basename(file.path)} <span className="muted">· {countIn(file)}</span>
              </a>
            ))}
          </div>
        )}
        <div className="nav">
          <button className="btn" onClick={() => jump(-1)} disabled={ordered.length === 0}>
            ↑ Previous
          </button>
          <button className="btn" onClick={() => jump(1)} disabled={ordered.length === 0}>
            Next ↓
          </button>
        </div>
      </nav>
    </aside>
  );
}
