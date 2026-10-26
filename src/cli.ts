#!/usr/bin/env node
import * as p from "@clack/prompts";
import { flag, flags } from "./args.js";
import { connect } from "./commands/connect.js";
import { init } from "./commands/init.js";
import { open } from "./commands/open.js";
import { review } from "./commands/review.js";
import { setup } from "./commands/setup.js";
import { debugDetail, formatError } from "./errors.js";

const USAGE = `Usage:
  lgtm setup
  lgtm init [--rules <file>] [--rules-dir <dir>] [--review <file>] [--voice <file>] [--remote <name>] [--token <token>]
  lgtm connect [--remote <name>] [--token <token>]
  lgtm review --mr <id> [--port <n>] [--no-open]
  lgtm open <mr> [--port <n>] [--no-open]`;

const [command, ...args] = process.argv.slice(2);

try {
  switch (command) {
    case "setup":
      process.exitCode = await setup();
      break;
    case "init":
      process.exitCode = await init({
        sources: [...flags(args, "rules"), ...flags(args, "rules-dir"), ...flags(args, "review")],
        voiceFile: flag(args, "voice"),
        remote: flag(args, "remote"),
        token: flag(args, "token"),
      });
      break;
    case "connect":
      process.exitCode = await connect({ remote: flag(args, "remote"), token: flag(args, "token") });
      break;
    case "review": {
      const mrId = Number(flag(args, "mr"));
      if (!Number.isInteger(mrId) || mrId <= 0) {
        console.error(`Missing or invalid --mr <id>\n${USAGE}`);
        process.exitCode = 1;
        break;
      }
      const portFlag = flag(args, "port");
      const port = portFlag === undefined ? undefined : Number(portFlag);
      if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) {
        console.error(`Invalid --port <n>\n${USAGE}`);
        process.exitCode = 1;
        break;
      }
      process.exitCode = await review(mrId, { port, open: !args.includes("--no-open") });
      break;
    }
    case "open": {
      const mrId = Number(args.find((arg, i) => !arg.startsWith("--") && args[i - 1] !== "--port"));
      if (!Number.isInteger(mrId) || mrId <= 0) {
        console.error(`Missing or invalid <mr>\n${USAGE}`);
        process.exitCode = 1;
        break;
      }
      const portFlag = flag(args, "port");
      const port = portFlag === undefined ? undefined : Number(portFlag);
      if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) {
        console.error(`Invalid --port <n>\n${USAGE}`);
        process.exitCode = 1;
        break;
      }
      process.exitCode = await open(mrId, { port, open: !args.includes("--no-open") });
      break;
    }
    default:
      console.error(`Unknown command: ${command ?? "(none)"}\n${USAGE}`);
      process.exitCode = 1;
  }
} catch (err) {
  p.cancel(formatError(err));
  if (process.env.LGTM_DEBUG) console.error(debugDetail(err));
  process.exitCode = 1;
}
