import { rmSync } from "node:fs";
import { once } from "node:events";
import * as p from "@clack/prompts";
import { openUrl } from "../server/open.js";
import { startServer } from "../server/server.js";
import { reviewTreePath } from "../review/tree.js";

export interface ServeOptions {
  port?: number;
  open: boolean;
}

export function removeTreeOnSignal(runId: string): () => void {
  const removeTreeAndExit = () => {
    rmSync(reviewTreePath(runId), { recursive: true, force: true });
    process.exit(130);
  };
  process.once("SIGINT", removeTreeAndExit);
  process.once("SIGTERM", removeTreeAndExit);
  return () => {
    process.off("SIGINT", removeTreeAndExit);
    process.off("SIGTERM", removeTreeAndExit);
  };
}

interface ServeRun {
  runFile: string;
  repoRoot: string;
  treeDir?: string;
  model?: string;
  options: ServeOptions;
}

export async function serveRun({ runFile, repoRoot, treeDir, model, options }: ServeRun): Promise<void> {
  const { url, server } = await startServer({ runFile, repoRoot, treeDir, model, port: options.port });
  p.log.message(`Review page: ${url}`);
  if (options.open && !(await openUrl(url))) p.log.warn("Couldn't open a browser, use the address above.");
  p.outro("Press Ctrl+C to stop");
  await once(server, "close");
}
