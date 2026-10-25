import { AgentError } from "./agent/errors.js";
import { HostError } from "./git/errors.js";

export interface ErrorSummary {
  kind: string;
  message: string;
}

export function summarizeError(err: unknown): ErrorSummary {
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof AgentError || err instanceof HostError) return { kind: err.kind, message };
  return { kind: "unknown", message };
}

export function formatError(err: unknown): string {
  const { message } = summarizeError(err);
  return err instanceof AgentError && err.hint ? `${message}\n${err.hint}` : message;
}

export function debugDetail(err: unknown): string {
  const stack = err instanceof Error ? (err.stack ?? err.message) : String(err);
  const raw = err instanceof AgentError || err instanceof HostError ? `\n\nraw output:\n${err.raw}` : "";
  return `${stack}${raw}`;
}
