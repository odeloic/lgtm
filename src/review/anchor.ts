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

export function clampToHunk(hunks: Range[], startLine: number, endLine: number): Range {
  const hunk = hunks.find(([start, end]) => startLine <= end && endLine >= start);
  if (!hunk) return [startLine, endLine];
  return [Math.max(startLine, hunk[0]), Math.min(endLine, hunk[1])];
}

const HUNK_COUNTS =/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function oldLineOf(diff: string, file: string, newLine: number): number | null {
  let inFile = false;
  let oldNo = 0;
  let newNo = 0;
  let oldLeft = 0;
  let newLeft = 0;
  for (const line of diff.split("\n")) {
    if (oldLeft > 0 || newLeft > 0) {
      if (line.startsWith("\\")) continue;
      if (line.startsWith("-")) {
        oldNo++;
        oldLeft--;
      } else if (line.startsWith("+")) {
        if (inFile && newNo === newLine) return null;
        newNo++;
        newLeft--;
      } else {
        if (inFile && newNo === newLine) return oldNo;
        oldNo++;
        newNo++;
        oldLeft--;
        newLeft--;
      }
    } else if (line.startsWith("diff --git ")) inFile = false;
    else if (line.startsWith("+++ ")) inFile = line.slice(4) === `b/${file}`;
    else {
      const hunk = HUNK_COUNTS.exec(line);
      if (!hunk) continue;
      oldNo = Number(hunk[1]);
      oldLeft = hunk[2] === undefined ? 1 : Number(hunk[2]);
      newNo = Number(hunk[3]);
      newLeft = hunk[4] === undefined ? 1 : Number(hunk[4]);
    }
  }
  return null;
}
