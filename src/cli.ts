#!/usr/bin/env node

const [command] = process.argv.slice(2);

switch (command) {
  case "init":
    console.log(process.cwd());
    break;
  default:
    console.error(`Unknown command: ${command ?? "(none)"}\nUsage: lgtm init`);
    process.exit(1);
}
