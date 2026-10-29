export type HostErrorKind = "auth" | "scope" | "forbidden" | "not-found" | "network" | "unknown";

const MATCHERS: { kind: Exclude<HostErrorKind, "unknown">; pattern: RegExp }[] = [
  { kind: "auth", pattern: /\b401\b|unauthorized|gh auth login|glab auth login|not logged in|no token found|authentication failed/i },
  { kind: "scope", pattern: /insufficient_scope/i },
  { kind: "forbidden", pattern: /\b403\b|forbidden|resource not accessible/i },
  { kind: "not-found", pattern: /\b404\b|not found|could not resolve to a pullrequest/i },
  { kind: "network", pattern: /dial tcp|no such host|could not resolve host|i\/o timeout|connection (refused|reset)|network is unreachable|error connecting to|proxyconnect|timed out|ECONNREFUSED|ENOTFOUND/i },
];

export class HostError extends Error {
  constructor(
    readonly kind: HostErrorKind,
    readonly bin: string,
    readonly raw: string,
    mrId: number,
  ) {
    super(describe(kind, bin, raw, mrId));
  }
}

export function hostFailure(bin: string, run: { code: number; stdout: string; stderr: string }, mrId: number): HostError {
  const raw = [run.stderr, run.stdout].map((s) => s.trim()).filter(Boolean).join("\n");
  return classifyHostFailure(bin, raw || `${bin} exited with code ${run.code}`, mrId);
}

export function classifyHostFailure(bin: string, raw: string, mrId: number): HostError {
  const kind = MATCHERS.find((m) => m.pattern.test(raw))?.kind ?? "unknown";
  return new HostError(kind, bin, raw, mrId);
}

function describe(kind: HostErrorKind, bin: string, raw: string, mrId: number): string {
  switch (kind) {
    case "auth":
      return `\`${bin}\` is not logged in or its token was rejected. Run \`${bin} auth login\`.`;
    case "scope": {
      const scope = /"scope"\s*:\s*"([^"]+)"/.exec(raw)?.[1] ?? "api";
      return `\`${bin}\`'s token is missing the \`${scope}\` scope. Run \`${bin} auth login\` with a token that has it.`;
    }
    case "forbidden":
      return `\`${bin}\` was refused access to !${mrId} (HTTP 403). Check the token's scopes and your role on the project.`;
    case "not-found":
      return `!${mrId} was not found. Check the id and that \`${bin}\` points at the right project.`;
    case "network":
      return `Couldn't reach the host through \`${bin}\`. Check your connection or VPN and try again.`;
    case "unknown":
      return `\`${bin}\` failed: ${raw.replace(/\s+/g, " ").trim().slice(0, 300)}`;
  }
}
