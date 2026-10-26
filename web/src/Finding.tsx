import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import type { FindingRecord } from "./api";
import { useCtx } from "./ctx";
import {
  SEVERITY_LABEL,
  SEVERITY_LEVEL,
  type Severity,
  type Status,
  basename,
  clock,
  duration,
  effectiveStatus,
  firstSentence,
  isLive,
  lineRange,
  plain,
  plural,
  timeOfDay,
} from "./format";
import { Icon } from "./Icon";
import { Inline, Text } from "./Text";

type Message = NonNullable<FindingRecord["thread"]>[number];
type Proposal = NonNullable<Message["proposal"]>;

const DISMISS_REASONS = ["Wrong", "Intended", "Not worth it"];

function SeverityMeter({ severity }: { severity: Severity }) {
  const level = SEVERITY_LEVEL[severity];
  return (
    <span className={`sev ${severity}`} title={`${SEVERITY_LABEL[severity]} severity`}>
      <span className="mtr" aria-hidden>
        {[1, 2, 3, 4].map((n) => (
          <i key={n} className={n <= level ? "on" : undefined} />
        ))}
      </span>
      {SEVERITY_LABEL[severity]}
    </span>
  );
}

function chipFor(status: Status): [string, string] {
  switch (status) {
    case "proposed":
      return ["info", "Proposed"];
    case "edited":
      return ["warn", "Edited"];
    case "accepted":
      return ["ok", "Accepted"];
    case "dropped":
      return ["closed", "Dropped by the verifier"];
    case "dismissed":
      return ["closed outline", "Ignored"];
    case "withdrawn":
      return ["closed outline", "Withdrawn"];
  }
}

function Chip({ f }: { f: FindingRecord }) {
  const [tone, label] = chipFor(effectiveStatus(f));
  return <span className={`chip ${tone}`}>{label}</span>;
}

function edits(f: FindingRecord) {
  const original = f.original;
  return {
    body: original !== undefined && original.body !== f.body,
    suggestion: original !== undefined && (original.suggestion ?? "") !== (f.suggestion ?? ""),
    applied: (f.thread ?? []).some((m) => m.proposal?.status === "applied" && m.proposal.body === f.body),
  };
}

function byline(f: FindingRecord): string {
  if (f.source === "user") return "your own comment";
  if (f.state === "withdrawn") {
    return (f.thread ?? []).some((m) => m.role === "user") ? "withdrawn by the reviewer after your question" : "withdrawn by the reviewer";
  }
  if (f.state === "dismissed") return "ignored by you";
  const edited = edits(f);
  const parts = [edited.body && "body", edited.suggestion && "suggestion"].filter(Boolean);
  const found = parts.length ? `found by the reviewer, ${parts.join(" and ")} edited by you` : "found by the reviewer";
  return f.general ? `${found} · outside the diff` : found;
}

function Location({ f }: { f: FindingRecord }) {
  const { fileAnchor, blobUrl } = useCtx();
  const label = `${basename(f.file)} : ${lineRange(f)}`;
  const anchor = f.general ? undefined : fileAnchor(f.file);
  const href = anchor ? `#${anchor}` : blobUrl(f.file, f.startLine, f.endLine);
  return (
    <div className="loc">
      {href ? (
        <a href={href} title={f.file} {...(!anchor && { target: "_blank", rel: "noreferrer" })}>
          {label}
        </a>
      ) : (
        <span className="mono" title={f.file}>
          {label}
        </span>
      )}
      <span className="by">· {byline(f)}</span>
    </div>
  );
}

function TitleBlock({ f, small }: { f: FindingRecord; small?: boolean }) {
  return (
    <div className="title">
      <h4 className={small ? "own" : undefined}>{f.title}</h4>
      <Location f={f} />
    </div>
  );
}

type Op = { kind: "ctx" | "add" | "del"; text: string } | { kind: "skip" };

function lineDiff(before: string[], after: string[]): Op[] {
  const n = before.length;
  const m = after.length;
  const lcs = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = before[i] === after[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && before[i] === after[j]) {
      ops.push({ kind: "ctx", text: before[i++]! });
      j++;
    } else if (j < m && (i === n || lcs[i]![j + 1]! >= lcs[i + 1]![j]!)) {
      ops.push({ kind: "add", text: after[j++]! });
    } else {
      ops.push({ kind: "del", text: before[i++]! });
    }
  }
  return ops;
}

function withContext(ops: Op[], context = 1): Op[] {
  const near = (i: number) => ops.slice(Math.max(0, i - context), i + context + 1).some((o) => o.kind !== "ctx");
  const kept: Op[] = [];
  ops.forEach((op, i) => {
    if (op.kind !== "ctx" || near(i)) kept.push(op);
    else if (kept.length > 0 && kept[kept.length - 1]?.kind !== "skip") kept.push({ kind: "skip" });
  });
  return kept[kept.length - 1]?.kind === "skip" ? kept.slice(0, -1) : kept;
}

const lines = (text: string) => text.replace(/\n$/, "").split("\n");

function Suggestion({ f, suggestion = f.suggestion }: { f: FindingRecord; suggestion?: string }) {
  const { lineText } = useCtx();
  if (suggestion === undefined || f.general) return null;
  const replaced: string[] = [];
  for (let n = f.startLine; n <= f.endLine; n++) {
    const text = lineText(f.file, n);
    if (text !== undefined) replaced.push(text);
  }
  const ops = withContext(lineDiff(replaced, lines(suggestion)));
  const where = f.startLine === f.endLine ? `line ${f.startLine}` : `lines ${lineRange(f)}`;
  return (
    <div className="sug">
      <header>Suggestion · replaces {where}</header>
      {ops.length === 0 ? (
        <div className="sl ctx">
          <span />
          <code>No change to {where}</code>
        </div>
      ) : (
        ops.map((op, i) =>
          op.kind === "skip" ? (
            <div key={i} className="sl ctx">
              <span>⋯</span>
              <code />
            </div>
          ) : (
            <div key={i} className={`sl ${op.kind}`}>
              <span>{op.kind === "add" ? "+" : op.kind === "del" ? "−" : " "}</span>
              <code>{op.text}</code>
            </div>
          ),
        )
      )}
    </div>
  );
}

function Evidence({ evidence }: { evidence: string }) {
  const { fileAnchor, blobUrl } = useCtx();
  const refs = evidence
    .split(";")
    .map((part) => part.trim())
    .map((part) => /^(\S+?):(\d+)(?:-(\d+))?$/.exec(part))
    .filter((match): match is RegExpExecArray => match !== null);
  if (refs.length === 0) return evidence.trim() ? <div className="ev">Evidence {evidence}</div> : null;
  return (
    <div className="ev">
      Evidence
      {refs.map(([ref, path, start, end]) => {
        const external = blobUrl(path!, Number(start), Number(end ?? start));
        const anchor = fileAnchor(path!);
        const href = external ?? (anchor && `#${anchor}`);
        return href ? (
          <a key={ref} href={href} {...(external && { target: "_blank", rel: "noreferrer" })}>
            {ref}
          </a>
        ) : (
          <code key={ref}>{ref}</code>
        );
      })}
    </div>
  );
}

function Attribution({ f }: { f: FindingRecord }) {
  const [showOriginal, setShowOriginal] = useState(false);
  const edited = edits(f);
  if (!f.original || (!edited.body && !edited.suggestion)) return null;
  const what = edited.body && edited.suggestion ? "the comment and the suggestion" : edited.body ? "the comment" : "the suggestion";
  return (
    <>
      <div className="attrib">
        <b>You</b>
        {edited.applied ? `applied the reviewer's revision to ${what}` : `edited ${what}`} ·{" "}
        <button className="link" onClick={() => setShowOriginal(!showOriginal)} aria-expanded={showOriginal}>
          {showOriginal ? "hide the reviewer's original" : "show the reviewer's original"}
        </button>
      </div>
      {showOriginal && (
        <div className="orig">
          <Text text={f.original.body} />
          {edited.suggestion && <Suggestion f={f} suggestion={f.original.suggestion ?? ""} />}
        </div>
      )}
    </>
  );
}

function severityBeforeRevisions(f: FindingRecord): Severity {
  return (f.revisions ?? []).find((r) => r.revision.severity)?.from.severity ?? f.severity;
}

function VerifierStrip({ f, onAgree }: { f: FindingRecord; onAgree: () => void }) {
  const { actions } = useCtx();
  const verdict = f.verdict;
  if (!verdict) return null;
  const dropped = verdict.verdict === "drop";
  return (
    <div className="verd">
      <div className="lab">
        <b>Verifier · {dropped ? "dropped" : "kept"}</b>
        {verdict.verdict === "downgrade" && verdict.from && (
          <span className="shift">
            <span className="was">{SEVERITY_LABEL[verdict.from]}</span> → {SEVERITY_LABEL[severityBeforeRevisions(f)]}
          </span>
        )}
      </div>
      <div className="said">
        <Text text={verdict.reason} />
        {effectiveStatus(f) === "dropped" && (
          <div className="row">
            <button className="btn" title="Agree with the verifier and ignore this finding" onClick={onAgree}>
              Agree
            </button>
            <button className="btn" title="Overrule the verifier and accept this finding" onClick={() => void actions.accept(f.id)}>
              Overrule
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Editor({ f, onDone }: { f: FindingRecord; onDone: () => void }) {
  const { actions } = useCtx();
  const [body, setBody] = useState(f.body);
  const [suggestion, setSuggestion] = useState(f.suggestion ?? "");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const change: { body?: string; suggestion?: string } = {};
    if (body !== f.body) change.body = body;
    if (!f.general && suggestion !== (f.suggestion ?? "")) change.suggestion = suggestion;
    const ok = Object.keys(change).length === 0 || (await actions.edit(f.id, change));
    setBusy(false);
    if (ok) onDone();
  };

  return (
    <form className="editor" onSubmit={submit}>
      <label>
        Comment
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} autoFocus />
      </label>
      {!f.general && (
        <label>
          Suggested replacement for lines {lineRange(f)}
          <textarea className="mono" value={suggestion} onChange={(e) => setSuggestion(e.target.value)} rows={4} spellCheck={false} />
        </label>
      )}
      <div className="row">
        <button className="btn pri" disabled={busy || !body.trim()}>
          Save
        </button>
        <button type="button" className="btn" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function Dismisser({ id, initial, onDone }: { id: string; initial: string; onDone: () => void }) {
  const { actions } = useCtx();
  const [reason, setReason] = useState(initial);
  const [busy, setBusy] = useState(false);

  const submit = async (text: string) => {
    if (!text.trim()) return;
    setBusy(true);
    const ok = await actions.dismiss(id, text.trim());
    setBusy(false);
    if (ok) onDone();
  };

  return (
    <form
      className="dismisser"
      onSubmit={(e) => {
        e.preventDefault();
        void submit(reason);
      }}
    >
      <div className="row">
        {DISMISS_REASONS.map((r) => (
          <button key={r} type="button" className="btn" disabled={busy} onClick={() => void submit(r)}>
            {r}
          </button>
        ))}
      </div>
      <div className="row">
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Or say why in your own words" autoFocus />
        <button className="btn pri" disabled={busy || !reason.trim()}>
          Ignore
        </button>
        <button type="button" className="btn" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function ProposalBox({ f, message, proposal }: { f: FindingRecord; message: Message; proposal: Proposal }) {
  const { actions } = useCtx();
  const applied = proposal.status === "applied" ? (f.revisions ?? []).find((r) => r.at >= message.at) : undefined;
  const before = applied?.from ?? { body: f.body, suggestion: f.suggestion, severity: f.severity };
  const current = new Set(lines(f.suggestion ?? "").map((l) => l.trim()));
  const proposed = proposal.suggestion ? lines(proposal.suggestion).filter((l) => l.trim()) : [];
  const unchanged = proposed.length > 0 && proposed.every((l) => current.has(l.trim()));

  return (
    <div className="prop">
      <header>
        Proposed revision
        <span className="sp" />
        {proposal.status === "ignored" && <span className="chip closed">Ignored by you</span>}
        {proposal.status === "applied" && <span className="chip ok">Applied</span>}
      </header>
      {proposal.withdraw && (
        <div className="diffline">
          <span />
          <span>Withdraw this finding</span>
        </div>
      )}
      {proposal.severity && (
        <div className="diffline">
          <span />
          <span>
            Severity <span className="was">{SEVERITY_LABEL[before.severity]}</span> → {SEVERITY_LABEL[proposal.severity]}
          </span>
        </div>
      )}
      {proposal.body !== undefined && (
        <>
          <div className="diffline del">
            <span>−</span>
            <span>{plain(before.body)}</span>
          </div>
          <div className="diffline add">
            <span>+</span>
            <span>{plain(proposal.body)}</span>
          </div>
        </>
      )}
      {proposal.suggestion === "" && (
        <div className="diffline del">
          <span>−</span>
          <span>Remove the suggestion</span>
        </div>
      )}
      {unchanged && (
        <div className="diffline quiet">
          <span />
          <span>+ {plural(proposed.length, "suggestion line")}, unchanged from yours</span>
        </div>
      )}
      {!unchanged &&
        proposed.map((line, i) => (
          <div key={i} className="diffline add mono-line">
            <span>+</span>
            <span>{line}</span>
          </div>
        ))}
      {proposal.status === "open" && (
        <div className="row">
          <button className="btn pri" onClick={() => void actions.applyProposal(f.id)}>
            Apply
          </button>
          <button className="btn" onClick={() => void actions.ignoreProposal(f.id)}>
            Ignore
          </button>
        </div>
      )}
    </div>
  );
}

function revisionText(revision: NonNullable<FindingRecord["revisions"]>[number]): [string, string] {
  if (revision.revision.withdraw) return ["undo-2", "The reviewer withdrew this finding"];
  if (revision.revision.severity) {
    return ["arrow-down", `The reviewer changed the severity from ${revision.from.severity} to ${revision.revision.severity}`];
  }
  return ["pencil", "The reviewer revised this finding"];
}

function Thread({ f }: { f: FindingRecord }) {
  const { actions, pendingSince, threadErrors } = useCtx();
  const [message, setMessage] = useState("");
  const [now, setNow] = useState(Date.now());
  const since = pendingSince[f.id];

  useEffect(() => {
    if (!f.pending) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [f.pending]);

  const send = async (event: FormEvent) => {
    event.preventDefault();
    const text = message.trim();
    if (!text) return;
    if (await actions.ask(f.id, text)) setMessage("");
  };

  const thread = f.thread ?? [];
  const timeline: { at: string; node: ReactNode }[] = [
    ...thread.map((m, i) => {
      const asked = thread[i - 1]?.role === "user" ? thread[i - 1]?.at : undefined;
      const waited = asked ? ` · ${duration(Date.parse(m.at) - Date.parse(asked))}` : "";
      const node =
        m.role === "agent" && m.error ? (
          <div key={`m${i}`} className="turn-error">
            <Icon name="triangle-alert" />
            <span>The reviewer could not answer: {m.error}</span>
          </div>
        ) : (
          <div key={`m${i}`} className={`turn${m.role === "agent" ? " agent" : ""}`}>
            <span className="av">{m.role === "agent" ? "R" : <Icon name="user" />}</span>
            <div>
              <div className="who">
                {m.role === "agent" ? "Reviewer" : "You"}{" "}
                <small>
                  {timeOfDay(m.at)}
                  {m.role === "agent" && waited}
                </small>
              </div>
              <Text text={m.text} />
              {m.proposal && <ProposalBox f={f} message={m} proposal={m.proposal} />}
            </div>
          </div>
        );
      return { at: m.at, node };
    }),
    ...(f.revisions ?? []).map((r, i) => {
      const [icon, text] = revisionText(r);
      return {
        at: r.at,
        node: (
          <div key={`r${i}`} className="event">
            <Icon name={icon} />
            <span>{text}</span>
            <small>{timeOfDay(r.at)}</small>
          </div>
        ),
      };
    }),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return (
    <div className="thread">
      <header>Thread with the reviewer</header>
      {timeline.map((t) => t.node)}
      {f.pending && (
        <div className="working">
          <Icon name="loader" spin />
          <span>
            The reviewer is working<span className="muted"> · {clock(now - (since ?? now))} · usually 30 to 60 seconds</span>
          </span>
        </div>
      )}
      {threadErrors[f.id] && !f.pending && (
        <div className="turn-error">
          <Icon name="triangle-alert" />
          <span>{threadErrors[f.id]}</span>
        </div>
      )}
      {isLive(f) && (
        <form className="reply" onSubmit={send}>
          <textarea
            value={message}
            rows={1}
            placeholder="Ask or reply to the reviewer"
            disabled={f.pending}
            autoFocus={thread.length === 0}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send(e);
            }}
          />
          <span className="hint" aria-label="Command Enter sends">
            <span className="kbd">⌘</span>
            <span className="kbd">↩</span>
          </span>
          <button className="btn pri" disabled={f.pending || !message.trim()}>
            Send
          </button>
        </form>
      )}
    </div>
  );
}

function ThreadToggle({ f, open, onToggle, ghost }: { f: FindingRecord; open: boolean; onToggle: () => void; ghost?: boolean }) {
  const { threads } = useCtx();
  const count = (f.thread ?? []).length;
  if (count === 0 && (!threads || !isLive(f))) return null;
  return (
    <button className={`btn${ghost || count === 0 ? " ghost" : ""} thread-btn`} onClick={onToggle} aria-expanded={open}>
      {count === 0 ? "Ask the reviewer" : `Thread (${count}) ${open ? "▾" : "▸"}`}
    </button>
  );
}

function CopyButton({ f }: { f: FindingRecord }) {
  const { actions } = useCtx();
  return (
    <button className="btn pri" onClick={() => void actions.copy(f.id)}>
      <Icon name="copy" />
      Copy
    </button>
  );
}

function useThreadOpen(f: FindingRecord): [boolean, () => void] {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (f.pending) setOpen(true);
  }, [f.pending]);
  return [open, () => setOpen((o) => !o)];
}

function ClosedFinding({ f }: { f: FindingRecord }) {
  const { actions } = useCtx();
  const [open, toggle] = useThreadOpen(f);
  const withdrawal = [...(f.thread ?? [])].reverse().find((m) => m.proposal?.withdraw);
  const reason =
    f.state === "dismissed"
      ? `Ignored by you: ${f.dismissReason ?? "no reason given"}`
      : withdrawal
        ? firstSentence(withdrawal.text)
        : "The reviewer withdrew this finding.";

  return (
    <article className="finding closed" id={`finding-${f.id}`}>
      <div className="compact">
        <TitleBlock f={f} />
        <div className="tags">
          <SeverityMeter severity={f.severity} />
          <Chip f={f} />
        </div>
      </div>
      <div className="acts">
        <Icon name={f.state === "dismissed" ? "ban" : "undo-2"} />
        <span className="why">
          <Inline text={reason} />
        </span>
        {f.state === "dismissed" && (
          <button className="btn" onClick={() => void actions.reset(f.id)}>
            Restore
          </button>
        )}
        <ThreadToggle f={f} open={open} onToggle={toggle} ghost />
      </div>
      {open && <Thread f={f} />}
    </article>
  );
}

function OwnComment({ f }: { f: FindingRecord }) {
  const [editing, setEditing] = useState(false);
  const [open, toggle] = useThreadOpen(f);
  const extra = f.body.trim() !== f.title.trim();

  return (
    <article className="finding" id={`finding-${f.id}`}>
      <div className="compact">
        <TitleBlock f={f} small />
        <div className="tags">
          <SeverityMeter severity={f.severity} />
          <Chip f={f} />
        </div>
      </div>
      {(editing || extra || f.suggestion !== undefined) && (
        <div className="body">
          {editing ? (
            <Editor f={f} onDone={() => setEditing(false)} />
          ) : (
            <>
              {extra && <Text text={f.body} />}
              <Suggestion f={f} />
            </>
          )}
        </div>
      )}
      {!editing && (
        <div className="acts">
          <CopyButton f={f} />
          <button className="btn" onClick={() => setEditing(true)}>
            Edit
          </button>
          <ThreadToggle f={f} open={open} onToggle={toggle} />
        </div>
      )}
      {open && <Thread f={f} />}
    </article>
  );
}

function ReviewerFinding({ f }: { f: FindingRecord }) {
  const { actions } = useCtx();
  const [editing, setEditing] = useState(false);
  const [dismissing, setDismissing] = useState<string | null>(null);
  const [open, toggle] = useThreadOpen(f);
  const status = effectiveStatus(f);
  const proposing = status === "proposed" || status === "edited";

  return (
    <article className="finding" id={`finding-${f.id}`}>
      <header>
        <TitleBlock f={f} />
        <div className="tags">
          <SeverityMeter severity={f.severity} />
          <span className="conf">confidence {f.confidence}</span>
          <Chip f={f} />
        </div>
      </header>
      <div className="body">
        {editing ? (
          <Editor f={f} onDone={() => setEditing(false)} />
        ) : (
          <>
            <Attribution f={f} />
            <Text text={f.body} />
            <Suggestion f={f} />
            <Evidence evidence={f.evidence} />
          </>
        )}
      </div>
      <VerifierStrip f={f} onAgree={() => setDismissing("The verifier was right")} />
      {!editing && (
        <div className="acts">
          <CopyButton f={f} />
          <button className="btn" onClick={() => setEditing(true)}>
            Edit
          </button>
          {proposing && (
            <button className="btn" onClick={() => void actions.accept(f.id)}>
              Accept
            </button>
          )}
          <button className="btn ghost danger" onClick={() => setDismissing("")}>
            Ignore…
          </button>
          <ThreadToggle f={f} open={open} onToggle={toggle} />
        </div>
      )}
      {dismissing !== null && (
        <div className="acts">
          <Dismisser id={f.id} initial={dismissing} onDone={() => setDismissing(null)} />
        </div>
      )}
      {open && <Thread f={f} />}
    </article>
  );
}

export function Finding({ f }: { f: FindingRecord }) {
  if (!isLive(f)) return <ClosedFinding f={f} />;
  if (f.source === "user") return <OwnComment f={f} />;
  return <ReviewerFinding f={f} />;
}
