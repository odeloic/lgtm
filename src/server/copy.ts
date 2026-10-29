import type { Platform } from "../git/host.js";
import type { FindingRecord } from "../schemas.js";

export function commentBody(f: FindingRecord, platform: Platform): string {
  const parts = [f.body.trim()];
  if (f.suggestion !== undefined && !f.general) {
    const longestRun = Math.max(0, ...[...f.suggestion.matchAll(/`+/g)].map((m) => m[0].length));
    const fence = "`".repeat(Math.max(3, longestRun + 1));
    const info = platform === "gitlab" ? `suggestion:-${f.endLine - f.startLine}+0` : "suggestion";
    parts.push("", `${fence}${info}`, f.suggestion.replace(/\n$/, ""), fence);
  }
  return parts.join("\n");
}

export function copyText(f: FindingRecord, platform: Platform): string {
  const lines = f.startLine === f.endLine ? `${f.startLine}` : `${f.startLine}-${f.endLine}`;
  return [`${f.file}:${lines}`, "", commentBody(f, platform)].join("\n");
}
