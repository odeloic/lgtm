import { rmSync, writeFileSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const CURSOR_PERMISSIONS = {
  permissions: {
    allow: ["Read(**)"],
    deny: ["Write(**)", "Shell(*)", "Read(.env*)", "Read(**/.env*)", "Read(**/*.pem)", "Read(**/*.key)"],
  },
};

export function cursorConfigPath(dir: string): string {
  return join(dir, ".cursor", "cli.json");
}

function union(a: unknown, b: string[]): string[] {
  return [...new Set([...(Array.isArray(a) ? a.filter((x): x is string => typeof x === "string") : []), ...b])];
}

function mergePermissions(existing: string | null): string {
  let base: Record<string, unknown> = {};
  try {
    const parsed: unknown = existing === null ? {} : JSON.parse(existing);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) base = parsed as Record<string, unknown>;
  } catch {
    base = {};
  }
  const current = base.permissions && typeof base.permissions === "object" ? (base.permissions as Record<string, unknown>) : {};
  const merged = {
    ...base,
    permissions: {
      ...current,
      allow: union(current.allow, CURSOR_PERMISSIONS.permissions.allow),
      deny: union(current.deny, CURSOR_PERMISSIONS.permissions.deny),
    },
  };
  return `${JSON.stringify(merged, null, 2)}\n`;
}

export async function withCursorPermissions<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const path = cursorConfigPath(dir);
  const original = await readFile(path, "utf8").catch(() => null);
  const dirExisted = await stat(dirname(path)).then(
    () => true,
    () => false,
  );
  const restore = () => {
    if (original !== null) writeFileSync(path, original);
    else if (dirExisted) rmSync(path, { force: true });
    else rmSync(dirname(path), { recursive: true, force: true });
  };
  const restoreAndExit = () => {
    restore();
    process.exit(130);
  };

  process.once("SIGINT", restoreAndExit);
  process.once("SIGTERM", restoreAndExit);
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, mergePermissions(original));
    return await fn();
  } finally {
    process.off("SIGINT", restoreAndExit);
    process.off("SIGTERM", restoreAndExit);
    restore();
  }
}
