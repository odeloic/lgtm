import { exec } from "../exec.js";

export async function repoRoot(cwd = process.cwd()): Promise<string | null> {
  const { code, stdout } = await exec("git", ["rev-parse", "--show-toplevel"], { cwd });
  return code === 0 ? stdout.trim() : null;
}
