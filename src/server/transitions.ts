import type { AppliedRevision, FindingRecord, FindingState, FindingText, ThreadRevision } from "../schemas.js";
import { HttpError } from "./http.js";

type Live = Exclude<FindingState, "dismissed" | "withdrawn">;

export const isLive = (f: FindingRecord): f is FindingRecord & { state: Live } =>
  f.state !== "dismissed" && f.state !== "withdrawn";

export function assertLive(f: FindingRecord, action: string): Live {
  if (f.state === "withdrawn") throw new HttpError(409, `${f.id} was withdrawn, nothing can ${action} it`);
  if (f.state === "dismissed") throw new HttpError(409, `${f.id} is dismissed, reset it before you ${action} it`);
  return f.state;
}

export function overrideNote(f: FindingRecord): string | undefined {
  return f.verdict?.verdict === "drop" ? `verify dropped ${f.id}; this overrides it` : undefined;
}

function textOf(f: FindingRecord): FindingText {
  return { body: f.body, ...(f.suggestion !== undefined && { suggestion: f.suggestion }) };
}

function setSuggestion(f: FindingRecord, suggestion: string | undefined): void {
  if (suggestion === undefined) return;
  if (suggestion === "") delete f.suggestion;
  else f.suggestion = suggestion;
}

export function edit(f: FindingRecord, change: { body?: string; suggestion?: string }): void {
  assertLive(f, "edit");
  if (change.body === undefined && change.suggestion === undefined) {
    throw new HttpError(400, "Send a body, a suggestion, or both");
  }
  if (change.body !== undefined && !change.body.trim()) throw new HttpError(400, "body can't be empty");
  if (change.suggestion && f.general) throw new HttpError(400, `${f.id} is a general note and can't carry a suggestion`);
  f.original ??= textOf(f);
  if (change.body !== undefined) f.body = change.body;
  setSuggestion(f, change.suggestion);
  f.state = "edited";
}

export function accept(f: FindingRecord): void {
  assertLive(f, "accept");
  f.state = "accepted";
}

export function dismiss(f: FindingRecord, reason: string): void {
  f.stateBeforeDismiss = assertLive(f, "dismiss");
  f.dismissReason = reason;
  f.state = "dismissed";
}

export function reset(f: FindingRecord): void {
  if (f.state !== "dismissed") throw new HttpError(409, `${f.id} is not dismissed`);
  f.state = f.stateBeforeDismiss ?? "proposed";
  delete f.stateBeforeDismiss;
  delete f.dismissReason;
}

export function applyRevision(f: FindingRecord, revision: ThreadRevision, at: string, asEdit: boolean): void {
  const from = { severity: f.severity, ...textOf(f) };
  const record: AppliedRevision = { at, from, revision };
  if (revision.withdraw) {
    f.state = "withdrawn";
  } else {
    if (revision.severity) f.severity = revision.severity;
    const textChanged = revision.body !== undefined || revision.suggestion !== undefined;
    if (asEdit && textChanged) f.original ??= textOf(f);
    if (revision.body !== undefined) f.body = revision.body;
    if (!f.general || revision.suggestion === "") setSuggestion(f, revision.suggestion);
    if (asEdit && textChanged) f.state = "edited";
  }
  (f.revisions ??= []).push(record);
}
