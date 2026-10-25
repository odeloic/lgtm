import type { FindingRecord } from "../schemas.js";

type Range = [start: number, end: number];

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

export function newSideRanges(diff: string): Map<string, Range[]> {
  const ranges = new Map<string, Range[]>();
  let current: Range[] | null = null;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) current = null;
    else if (line.startsWith("+++ ")) {
      const path = line.slice(4);
      if (path.startsWith("b/")) {
        current = [];
        ranges.set(path.slice(2), current);
      }
    } else if (current) {
      const hunk = HUNK_HEADER.exec(line);
      if (!hunk) continue;
      const start = Number(hunk[1]);
      const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
      if (count > 0) current.push([start, start + count - 1]);
    }
  }
  return ranges;
}

export function anchorFindings(findings: FindingRecord[], diff: string): FindingRecord[] {
  const ranges = newSideRanges(diff);
  return findings.map((f) => {
    const hunks = ranges.get(f.file) ?? [];
    const overlaps = hunks.some(([start, end]) => f.startLine <= end && f.endLine >= start);
    const contained = hunks.some(([start, end]) => f.startLine >= start && f.endLine <= end);
    const { suggestion, ...rest } = f;
    if (!overlaps) return { ...rest, general: true };
    return contained && suggestion !== undefined ? { ...rest, suggestion } : rest;
  });
}
