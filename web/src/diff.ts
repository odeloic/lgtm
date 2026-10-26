export interface DiffLine {
  kind: "add" | "del" | "ctx";
  oldNo: number | null;
  newNo: number | null;
  text: string;
}

export interface Hunk {
  header: string;
  lines: DiffLine[];
}

export interface DiffFile {
  path: string;
  oldPath: string | null;
  status: "added" | "deleted" | "renamed" | "modified";
  binary: boolean;
  hunks: Hunk[];
  added: number;
  removed: number;
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function parseDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  let file: DiffFile | null = null;
  let hunk: Hunk | null = null;
  let oldNo = 0;
  let newNo = 0;

  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const paths = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
      file = { path: paths?.[2] ?? "", oldPath: null, status: "modified", binary: false, hunks: [], added: 0, removed: 0 };
      files.push(file);
      hunk = null;
      continue;
    }
    if (!file) continue;
    if (!hunk) {
      if (line.startsWith("new file mode")) file.status = "added";
      else if (line.startsWith("deleted file mode")) file.status = "deleted";
      else if (line.startsWith("rename from ")) {
        file.status = "renamed";
        file.oldPath = line.slice("rename from ".length);
      } else if (line.startsWith("Binary files") || line.startsWith("GIT binary patch")) file.binary = true;
      else if (line.startsWith("+++ b/")) file.path = line.slice("+++ b/".length);
      else if (line.startsWith("--- a/") && file.status === "deleted") file.path = line.slice("--- a/".length);
    }
    const start = HUNK.exec(line);
    if (start) {
      oldNo = Number(start[1]);
      newNo = Number(start[2]);
      hunk = { header: line, lines: [] };
      file.hunks.push(hunk);
      continue;
    }
    if (!hunk) continue;
    const mark = line[0];
    if (mark === "+") {
      hunk.lines.push({ kind: "add", oldNo: null, newNo: newNo++, text: line.slice(1) });
      file.added++;
    } else if (mark === "-") {
      hunk.lines.push({ kind: "del", oldNo: oldNo++, newNo: null, text: line.slice(1) });
      file.removed++;
    } else if (mark === " ") {
      hunk.lines.push({ kind: "ctx", oldNo: oldNo++, newNo: newNo++, text: line.slice(1) });
    }
  }
  return files;
}

export function newSideStart(hunk: Hunk): number {
  return hunk.lines.find((l) => l.newNo !== null)?.newNo ?? 0;
}

export function newSideEnd(hunk: Hunk): number {
  return [...hunk.lines].reverse().find((l) => l.newNo !== null)?.newNo ?? 0;
}
