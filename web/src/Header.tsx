import type { FindingRecord, HeadStatus, RunView, Score } from "./api";
import { compact, dateTime, duration, effectiveStatus, plural, shortSha } from "./format";
import { Icon } from "./Icon";
import { ThemeToggle } from "./ThemeToggle";

type Entry = RunView["ledger"][number];

const PLATFORM_NAME: Record<RunView["platform"], string> = { github: "GitHub", gitlab: "GitLab" };

const PHASES: [string, (phase: Entry["phase"]) => boolean][] = [
  ["Review", (p) => p === "review" || p === "init"],
  ["Verify", (p) => p === "verify"],
  ["Replies", (p) => p === "thread"],
];

function sum(entries: Entry[]) {
  const total = { input: 0, output: 0, cached: 0, ms: 0, cost: null as number | null };
  for (const e of entries) {
    total.input += e.tokens?.input ?? 0;
    total.output += e.tokens?.output ?? 0;
    total.cached += e.tokens?.cacheRead ?? 0;
    total.ms += e.durationMs;
    if (e.costUsd !== null) total.cost = (total.cost ?? 0) + e.costUsd;
  }
  return total;
}

const breakdown = (t: ReturnType<typeof sum>) =>
  `${t.input.toLocaleString()} in · ${t.output.toLocaleString()} out · ${t.cached.toLocaleString()} cached`;

function Ledger({ ledger }: { ledger: Entry[] }) {
  const total = sum(ledger);
  const rows = PHASES.map(([label, test]) => ({ label, entries: ledger.filter((e) => test(e.phase)) }))
    .filter((r) => r.entries.length > 0)
    .map((r) => ({ label: r.label, ...sum(r.entries) }));

  return (
    <details className="ledger">
      <summary>
        <span>Tokens and time</span>
        <span className="mono">
          {compact(total.input + total.output)} · {duration(total.ms)}
        </span>
      </summary>
      <table>
        <thead>
          <tr>
            <th />
            <td className="muted">Tokens</td>
            <td className="muted">Time</td>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} title={breakdown(r)}>
              <th scope="row">{r.label}</th>
              <td>{compact(r.input + r.output)}</td>
              <td>{duration(r.ms)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr title={breakdown(total)}>
            <th scope="row">Total</th>
            <td>{compact(total.input + total.output)}</td>
            <td>{duration(total.ms)}</td>
          </tr>
        </tfoot>
      </table>
      {total.cost !== null && <p className="muted">Estimated cost ${total.cost.toFixed(2)}</p>}
    </details>
  );
}

function ScoreBlock({ score }: { score: Score }) {
  return (
    <div className="score">
      <b>
        {score.score}
        <span>/ 100</span>
      </b>
      {Object.entries(score.byCategory).map(([category, lost]) => {
        const share = `${Math.min(100, lost)}%`;
        return (
          <div className="cat" key={category}>
            <span>{category}</span>
            <div className="bar" role="img" aria-label={`${category}: ${lost} points lost`}>
              <i style={{ right: share }} />
              {lost > 0 && <i className="lost" style={{ width: share }} />}
            </div>
            <span className={`bar-k${lost > 0 ? "" : " none"}`}>{lost > 0 ? `−${lost}` : "0"}</span>
          </div>
        );
      })}
    </div>
  );
}

function Counts({ findings }: { findings: FindingRecord[] }) {
  const statuses = findings.map(effectiveStatus);
  const count = (...wanted: string[]) => statuses.filter((s) => wanted.includes(s)).length;
  const dropped = count("dropped");
  const ignored = count("dismissed");
  const withdrawn = count("withdrawn");

  return (
    <div className="counts">
      <b>{plural(findings.length, "finding")}</b>
      <span>
        <i className="dot ok" />
        {count("accepted")} accepted
      </span>
      <span>
        <i className="dot open" />
        {count("proposed", "edited")} open
      </span>
      {dropped > 0 && (
        <span>
          <i className="dot closed" />
          {dropped} dropped by the verifier
        </span>
      )}
      {ignored > 0 && (
        <span>
          <i className="dot closed" />
          {ignored} ignored by you
        </span>
      )}
      {withdrawn > 0 && (
        <span>
          <i className="dot closed" />
          {withdrawn} withdrawn by the reviewer
        </span>
      )}
    </div>
  );
}

export function TopBar({ run }: { run: RunView }) {
  return (
    <div className="top">
      <span className="brand">
        <i />
        lgtm
      </span>
      <span className="crumb">
        {run.repo && `${run.repo.name} · `}
        <b>!{run.mr.id}</b>
      </span>
      <span className="sp" />
      {run.repo && (
        <a className="btn ghost" href={run.repo.mrUrl} target="_blank" rel="noreferrer">
          Open in {PLATFORM_NAME[run.platform]}
        </a>
      )}
      <ThemeToggle />
    </div>
  );
}

export function Header({ run, head }: { run: RunView; head: HeadStatus | null }) {
  const { mr } = run;

  return (
    <>
      {head?.moved && (
        <div className="banner">
          <Icon name="triangle-alert" />
          <span>
            The merge request has new commits since this review ({shortSha(head.reviewedSha)} → {shortSha(head.currentSha)}). Line numbers may have
            shifted.
          </span>
        </div>
      )}
      <header className="hd">
        <div>
          <h1>{mr.title}</h1>
          <dl className="meta">
            <div>
              <dt>Author</dt>
              <dd>{mr.author}</dd>
            </div>
            <div>
              <dt>Head</dt>
              <dd className="mono">
                {shortSha(mr.headSha)} → {mr.targetBranch}
              </dd>
            </div>
            <div>
              <dt>Reviewed</dt>
              <dd>{dateTime(run.reviewedAt)}</dd>
            </div>
            <div>
              <dt>Took</dt>
              <dd>{duration(sum(run.ledger).ms)}</dd>
            </div>
          </dl>
        </div>
        <div className="verdict">
          <ScoreBlock score={run.score} />
          <Counts findings={run.findings} />
        </div>
        <Ledger ledger={run.ledger} />
      </header>
    </>
  );
}
