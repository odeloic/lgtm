import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

export const USER_DIR = join(homedir(), ".lgtm");
export const USER_CONFIG_PATH = join(USER_DIR, "config.json");
export const USER_VOICE_PATH = join(USER_DIR, "voice.md");
export const USER_AUTH_PATH = join(USER_DIR, "auth.json");

const UserConfig = z.looseObject({
  model: z.string().optional(),
});
export type UserConfig = z.infer<typeof UserConfig>;

export async function readUserConfig(): Promise<UserConfig> {
  try {
    return UserConfig.parse(JSON.parse(await readFile(USER_CONFIG_PATH, "utf8")));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
}

export async function writeUserConfig(config: UserConfig): Promise<void> {
  await mkdir(USER_DIR, { recursive: true });
  await writeFile(USER_CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
}
