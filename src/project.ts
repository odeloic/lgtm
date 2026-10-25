import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

export const PROJECT_DIR = ".lgtm";

export const DEFAULT_SKIP = [
  "**/pnpm-lock.yaml",
  "**/package-lock.json",
  "**/yarn.lock",
  "**/*.lock",
  "**/go.sum",
  "**/*.min.js",
  "**/*.map",
  "**/dist/**",
  "**/generated/**",
  "**/__generated__/**",
];

export const ProjectConfig = z.object({
  provider: z.enum(["github", "gitlab"]),
  host: z.string(),
  project: z.string(),
  remote: z.string().default("origin"),
  skip: z.array(z.string()).default(DEFAULT_SKIP),
  confirmAboveTokens: z.int().positive().default(150_000),
});
export type ProjectConfig = z.infer<typeof ProjectConfig>;

export const projectPath = (repoRoot: string, ...parts: string[]) => join(repoRoot, PROJECT_DIR, ...parts);

export async function readProjectConfig(repoRoot: string): Promise<ProjectConfig | null> {
  try {
    return ProjectConfig.parse(JSON.parse(await readFile(projectPath(repoRoot, "config.json"), "utf8")));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function writeProjectConfig(repoRoot: string, config: ProjectConfig): Promise<void> {
  await ensureProjectDir(repoRoot);
  await writeFile(projectPath(repoRoot, "config.json"), `${JSON.stringify(config, null, 2)}\n`);
}

export async function ensureProjectDir(repoRoot: string): Promise<void> {
  await mkdir(projectPath(repoRoot), { recursive: true });
  await writeFile(projectPath(repoRoot, ".gitignore"), "runs/\n");
}
