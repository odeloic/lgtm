import type { FindingRecord } from "./api";

export type Status = Exclude<FindingRecord["state"], "copied"> | "dropped";
export type Severity = FindingRecord["severity"];

export function effectiveStatus(f: FindingRecord): Status {
  if (f.state === "copied") return "accepted";
  return f.verdict?.verdict === "drop" && f.state === "proposed" ? "dropped" : f.state;
}

export const isLive = (f: FindingRecord) => f.state !== "dismissed" && f.state !== "withdrawn";

export const STATE_WORD: Record<Status, string> = {
  proposed: "proposed",
  edited: "edited",
  accepted: "accepted",
  dismissed: "ignored",
  withdrawn: "withdrawn",
  dropped: "dropped",
};

export const SEVERITIES = ["blocking", "major", "minor", "nit"] as const satisfies readonly Severity[];

export const SEVERITY_LABEL: Record<Severity, string> = {
  blocking: "Blocking",
  major: "Major",
  minor: "Minor",
  nit: "Nit",
};

export const SEVERITY_LEVEL: Record<Severity, number> = { blocking: 4, major: 3, minor: 2, nit: 1 };

export const STATE_FILTERS = [
  ["all", "All"],
  ["open", "Open"],
  ["accepted", "Accepted"],
  ["dropped", "Dropped"],
  ["ignored", "Ignored"],
  ["withdrawn", "Withdrawn"],
] as const;

export type StateFilter = (typeof STATE_FILTERS)[number][0];
export type SeverityFilter = "all" | Severity;

export const ALWAYS_SHOWN_STATES: ReadonlySet<StateFilter> = new Set(["all", "open", "accepted", "withdrawn"]);
export const ALWAYS_SHOWN_SEVERITIES: ReadonlySet<SeverityFilter> = new Set(["all", "major", "minor", "nit"]);

export function matches(f: FindingRecord, state: StateFilter, severity: SeverityFilter): boolean {
  if (severity !== "all" && f.severity !== severity) return false;
  const status = effectiveStatus(f);
  switch (state) {
    case "all":
      return true;
    case "open":
      return status === "proposed" || status === "edited";
    case "accepted":
      return status === "accepted";
    case "dropped":
      return status === "dropped";
    case "ignored":
      return status === "dismissed";
    case "withdrawn":
      return status === "withdrawn";
  }
}

export const lineRange = (f: Pick<FindingRecord, "startLine" | "endLine">) =>
  f.startLine === f.endLine ? `${f.startLine}` : `${f.startLine}–${f.endLine}`;

export const shortSha = (sha: string) => sha.slice(0, 7);

export const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1);
export const dirname = (path: string) => path.slice(0, path.lastIndexOf("/") + 1);

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function clock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function duration(ms: number): string {
  const total = Math.round(ms / 1000);
  return total < 60 ? `${total}s` : `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, "0")}s`;
}

export function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

const DAY = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });
const TIME = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

export const timeOfDay = (iso: string) => TIME.format(new Date(iso));
export const dateTime = (iso: string) => `${DAY.format(new Date(iso))}, ${timeOfDay(iso)}`;

export const plain = (text: string) => text.replace(/`([^`]+)`/g, "$1").replace(/\*\*([^*]+)\*\*/g, "$1");

export function firstSentence(text: string): string {
  const trimmed = text.trim();
  const end = /[.!?](\s|$)/.exec(trimmed);
  return end ? trimmed.slice(0, end.index + 1) : trimmed;
}
