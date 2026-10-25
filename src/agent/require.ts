import type * as p from "@clack/prompts";
import { INSTALL_HINT, checkAuth } from "./auth.js";
import { AgentError, classifyAgentText } from "./errors.js";
import { onAgentRetry } from "./runAgent.js";

type Spinner = ReturnType<typeof p.spinner>;

export function showRetries(spin: Spinner): () => void {
  onAgentRetry(({ attempt, of, delayMs }) =>
    spin.message(`Cursor rate limit hit, retrying in ${delayMs / 1000}s (${attempt}/${of})`),
  );
  return () => onAgentRetry(undefined);
}

export async function requireAgent(spin: Spinner): Promise<void> {
  spin.start("Checking Cursor agent");
  const auth = await checkAuth();
  switch (auth.kind) {
    case "missing":
      spin.error("Cursor agent not found in PATH");
      throw new Error(`Cursor agent not found in PATH. ${INSTALL_HINT}`);
    case "logged-out":
      spin.error(`agent ${auth.version} is not logged in`);
      throw new AgentError("auth", auth.message, "Run `agent login`");
    case "rejected":
      spin.error(`agent ${auth.version} has a local session, but Cursor rejected it`);
      throw rejection(auth.reason);
    case "ok":
      spin.stop(`agent ${auth.version}`);
  }
}

function rejection(reason: string): AgentError {
  const classified = classifyAgentText(reason);
  return classified.kind === "unknown" ? classified : new AgentError("auth", reason, "Run `agent login`");
}
