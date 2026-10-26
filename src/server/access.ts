import { createHash, timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { HttpError } from "./http.js";

const digest = (value: string) => createHash("sha256").update(value).digest();

export function requestToken(request: Request): string | undefined {
  const bearer = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "");
  return bearer?.[1] ?? new URL(request.url).searchParams.get("token") ?? undefined;
}

export function hostGuard(allowedHosts: Set<string>): MiddlewareHandler {
  return async (c, next) => {
    if (!allowedHosts.has(c.req.header("host") ?? "")) throw new HttpError(403, "Forbidden host");
    await next();
  };
}

export function tokenGuard(token: string, isPublic: (path: string) => boolean): MiddlewareHandler {
  const expected = digest(token);
  return async (c, next) => {
    if (isPublic(c.req.path)) return next();
    const given = requestToken(c.req.raw);
    if (given === undefined || !timingSafeEqual(digest(given), expected)) throw new HttpError(403, "Forbidden");
    await next();
  };
}
