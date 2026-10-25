export type AgentErrorKind = "auth" | "rate-limit" | "quota" | "timeout" | "unknown";

const MATCHERS: { kind: Exclude<AgentErrorKind, "timeout" | "unknown">; pattern: RegExp }[] = [
  { kind: "auth", pattern: /authentication required|api key is invalid|not logged in|unauthenticated|please log ?in/i },
  { kind: "quota", pattern: /usage limit|spend limit|out of (credits|usage)|no (more )?credits|quota (exceeded|reached)|exceeded your (monthly|plan)|upgrade (to|your)/i },
  { kind: "rate-limit", pattern: /rate.?limit|too many requests|\b429\b|resource.?exhausted|try again (later|in)/i },
];

const SUMMARY: Record<AgentErrorKind, { message: string; hint?: string }> = {
  auth: { message: "Cursor agent is not authenticated", hint: "Run `agent login`" },
  "rate-limit": { message: "Cursor rate limit hit", hint: "Wait a minute and run the command again" },
  quota: { message: "Cursor usage limit reached", hint: "Raise your limit or wait for it to reset in the Cursor dashboard" },
  timeout: { message: "Cursor agent timed out", hint: "Run the command again, or pick a faster model with `lgtm setup`" },
  unknown: { message: "Cursor agent failed" },
};

const MAX_DETAIL = 300;

export interface AgentFailure {
  code: number;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

export class AgentError extends Error {
  constructor(
    readonly kind: AgentErrorKind,
    readonly raw: string,
    readonly hint?: string,
  ) {
    super(describe(kind, raw));
  }
}

export function classifyAgentFailure({ code, signal, stdout, stderr }: AgentFailure): AgentError {
  const raw = [stderr, stdout].map((text) => text.trim()).filter(Boolean).join("\n") || `agent exited with code ${code}`;
  const kind = signal === "SIGTERM" ? "timeout" : (MATCHERS.find((m) => m.pattern.test(raw))?.kind ?? "unknown");
  return new AgentError(kind, raw, SUMMARY[kind].hint);
}

export function classifyAgentText(raw: string): AgentError {
  return classifyAgentFailure({ code: 1, signal: null, stdout: raw, stderr: "" });
}

function describe(kind: AgentErrorKind, raw: string): string {
  if (kind !== "unknown") return SUMMARY[kind].message;
  const firstLine = raw.replace(/\x1b\[[0-9;]*m/g, "").split("\n").find((line) => line.trim()) ?? raw;
  const detail = firstLine.replace(/^(⚠\s*)?(Error:\s*)?/, "").trim();
  return `${SUMMARY.unknown.message}: ${detail.length > MAX_DETAIL ? `${detail.slice(0, MAX_DETAIL)}…` : detail}`;
}
