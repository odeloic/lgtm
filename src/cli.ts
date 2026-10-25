#!/usr/bin/env node
import { init } from "./commands/init.js";
import { setup } from "./commands/setup.js";

const USAGE = "Usage: lgtm <init|setup>";

const [command] = process.argv.slice(2);

switch (command) {
  case "init":
    process.exitCode = await init();
    break;
  case "setup":
    process.exitCode = await setup();
    break;
  default:
    console.error(`Unknown command: ${command ?? "(none)"}\n${USAGE}`);
    process.exitCode = 1;
}
