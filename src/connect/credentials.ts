import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { USER_AUTH_PATH, USER_DIR } from "../config.js";

const SERVICE = "lgtm";
const AuthFile = z.record(z.string(), z.string());

export type TokenStore = "keychain" | "file";

async function keyringEntry(host: string) {
  try {
    const { Entry } = await import("@napi-rs/keyring");
    return new Entry(SERVICE, host);
  } catch {
    return null;
  }
}

async function readAuthFile(): Promise<Record<string, string>> {
  try {
    return AuthFile.parse(JSON.parse(await readFile(USER_AUTH_PATH, "utf8")));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
}

export async function loadStoredToken(host: string): Promise<string | null> {
  try {
    const token = (await keyringEntry(host))?.getPassword();
    if (token) return token;
  } catch {}
  return (await readAuthFile())[host] ?? null;
}

export async function storeToken(host: string, token: string): Promise<TokenStore> {
  try {
    const entry = await keyringEntry(host);
    if (entry) {
      entry.setPassword(token);
      return "keychain";
    }
  } catch {}
  const auth = { ...(await readAuthFile()), [host]: token };
  await mkdir(USER_DIR, { recursive: true });
  await writeFile(USER_AUTH_PATH, `${JSON.stringify(auth, null, 2)}\n`, { mode: 0o600 });
  await chmod(USER_AUTH_PATH, 0o600);
  return "file";
}
