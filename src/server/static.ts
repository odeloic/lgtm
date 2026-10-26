import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const WEB_DIST = fileURLToPath(new URL("../../web/dist", import.meta.url));

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

const PLACEHOLDER = "<!doctype html><title>lgtm</title><p>lgtm is serving this review, but the review page isn't built yet.</p>";

export async function readAsset(urlPath: string): Promise<{ body: Uint8Array<ArrayBuffer> | string; type: string } | null> {
  const relative = normalize(decodeURIComponent(urlPath)).replace(/^[/\\]+/, "");
  const file = join(WEB_DIST, relative);
  if (file !== WEB_DIST && !file.startsWith(WEB_DIST + sep)) return null;
  try {
    return { body: new Uint8Array(await readFile(file)), type: CONTENT_TYPES[extname(file)] ?? "application/octet-stream" };
  } catch {
    return null;
  }
}

export async function readIndex(): Promise<{ body: Uint8Array<ArrayBuffer> | string; type: string }> {
  return (await readAsset("index.html")) ?? { body: PLACEHOLDER, type: CONTENT_TYPES[".html"] as string };
}
