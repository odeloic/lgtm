#!/usr/bin/env node
import { flag, flags } from "./args.js";
import { connect } from "./commands/connect.js";
import { init } from "./commands/init.js";
import { review } from "./commands/review.js";
import { setup } from "./commands/setup.js";

const USAGE = `Usage:
  lgtm setup
  lgtm init [--rules <file>] [--rules-dir <dir>] [--review <file>] [--voice <file>] [--remote <name>] [--token <token>]
  lgtm connect [--remote <name>] [--token <token>]
  lgtm review --mr <id>`;

const [command, ...args] = process.argv.slice(2);

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
    process.exitCode = await review(mrId);
    break;
  }
  default:
    console.error(`Unknown command: ${command ?? "(none)"}\n${USAGE}`);
    process.exitCode = 1;
}
