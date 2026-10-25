import type { z } from "zod";

const FENCED = /```(?:json)?\s*\n([\s\S]*?)\n```/g;

export function extractJson(text: string): unknown {
  const fenced = [...text.matchAll(FENCED)].map((m) => m[1]).at(-1);
  if (fenced !== undefined) return JSON.parse(fenced);
  const objects = topLevelObjects(text);
  for (const candidate of objects.reverse()) {
    try {
      return JSON.parse(candidate);
    } catch {}
  }
  throw new Error("No JSON object found in the answer");
}

function topLevelObjects(text: string): string[] {
  const objects: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"' && depth > 0) inString = true;
    else if (char === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (char === "}" && depth > 0) {
      depth--;
      if (depth === 0) objects.push(text.slice(start, i + 1));
    }
  }
  return objects;
}

export function parseAgentJson<T>(text: string, schema: z.ZodType<T>): { ok: true; value: T } | { ok: false; error: string } {
  try {
    const parsed = schema.safeParse(extractJson(text));
    return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: parsed.error.message };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
