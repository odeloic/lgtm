import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import picomatch from "picomatch";
import { exec } from "../exec.js";

const CONTEXT_FILES = [
  "**/AGENTS.md",
  "**/CLAUDE.md",
  "**/RULES.md",
  "**/REVIEW.md",
  "**/CONTRIBUTING.md",
  ".cursor/rules/**",
  "**/.cursorrules",
];

const SECRETS = ["**/.env*", "**/*.pem", "**/*.key"];
const MAX_FILE_BYTES = 30_000;
const MAX_TOTAL_BYTES = 150_000;

export interface Source {
  path: string;
  content: string | null;
}

export async function collectSources(repoRoot: string, extraPaths: string[] = []): Promise<Source[]> {
  const { stdout } = await exec("git", ["ls-files", "-z"], { cwd: repoRoot });
  const isContext = picomatch(CONTEXT_FILES, { dot: true });
  const isSecret = picomatch(SECRETS, { dot: true });
  const tracked = stdout.split("\0").filter((f) => f && isContext(f));
  const extras = (await Promise.all(extraPaths.map((p) => expand(repoRoot, p)))).flat();
  const paths = [...new Set([...extras, ...tracked])].filter((f) => !isSecret(f));

  let total = 0;
  const sources: Source[] = [];
  for (const path of paths) {
    const content = await readFile(join(repoRoot, path), "utf8");
    const fits = content.length <= MAX_FILE_BYTES && total + content.length <= MAX_TOTAL_BYTES;
    if (fits) total += content.length;
    sources.push({ path, content: fits ? content : null });
  }
  return sources;
}

async function expand(repoRoot: string, path: string): Promise<string[]> {
  const absolute = join(repoRoot, path);
  if (!(await stat(absolute)).isDirectory()) return [relative(repoRoot, absolute)];
  const entries = await readdir(absolute, { recursive: true, withFileTypes: true });
  return entries.filter((e) => e.isFile()).map((e) => relative(repoRoot, join(e.parentPath, e.name)));
}
