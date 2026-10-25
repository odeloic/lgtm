import type { z } from "zod";

const FENCED = /```(?:json)?\s*\n([\s\S]*?)\n```/g;

export function extractJson(text: string): unknown {
  const fenced = [...text.matchAll(FENCED)].map((m) => m[1]).at(-1);
  const candidate = fenced ?? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  return JSON.parse(candidate);
}

export function parseAgentJson<T>(text: string, schema: z.ZodType<T>): { ok: true; value: T } | { ok: false; error: string } {
  try {
    const parsed = schema.safeParse(extractJson(text));
    return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: parsed.error.message };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
