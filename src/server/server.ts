import { randomBytes } from "node:crypto";
import type { Server } from "node:http";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { RunStore } from "./store.js";
import { ThreadRunner } from "./threads.js";

export interface ServerOptions {
  runFile: string;
  repoRoot: string;
  treeDir?: string;
  model?: string;
  port?: number;
}

export interface RunningServer {
  url: string;
  server: Server;
}

export async function startServer({ runFile, repoRoot, treeDir, model, port = 0 }: ServerOptions): Promise<RunningServer> {
  const store = await RunStore.load(runFile);
  const token = randomBytes(24).toString("base64url");
  const allowedHosts = new Set<string>();
  const app = createApp({ store, threads: new ThreadRunner(store, treeDir, model), repoRoot, token, allowedHosts });

  const server = await new Promise<Server>((resolve, reject) => {
    const listening = serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, () => resolve(listening as Server));
    listening.once("error", reject);
  });
  const { port: boundPort } = server.address() as { port: number };
  allowedHosts.add(`127.0.0.1:${boundPort}`).add(`localhost:${boundPort}`);

  return { url: `http://127.0.0.1:${boundPort}/?token=${token}`, server };
}
