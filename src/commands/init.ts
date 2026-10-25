import * as p from "@clack/prompts";
import { runAgent } from "../agent/runAgent.js";
import { readUserConfig } from "../config.js";
import { checkCliAuth } from "../git/auth.js";
import { PLATFORM_NAME, type Platform, detectPlatform } from "../git/host.js";
import { getOrigin } from "../git/remote.js";

const SUMMARY_PROMPT = "What is this project about? Answer with a short summary.";

export async function init(): Promise<number> {
  const cwd = process.cwd();
  p.intro("lgtm init");

  const spin = p.spinner();
  spin.start("Checking where the project is hosted");
  const origin = await getOrigin(cwd);
  if (!origin) {
    spin.error("No `origin` remote found");
    p.cancel("Run `lgtm init` inside a git repository with an `origin` remote.");
    return 1;
  }

  let platform = await detectPlatform(origin.host);
  if (platform) {
    spin.stop(`${origin.host}/${origin.path} (${PLATFORM_NAME[platform]})`);
  } else {
    spin.stop(`${origin.host}/${origin.path}`);
    const choice = await p.select<Platform>({
      message: `Which platform hosts ${origin.host}?`,
      options: [
        { value: "github", label: PLATFORM_NAME.github },
        { value: "gitlab", label: PLATFORM_NAME.gitlab },
      ],
    });
    if (p.isCancel(choice)) {
      p.cancel("Init cancelled.");
      return 1;
    }
    platform = choice;
  }

  spin.start(`Checking ${PLATFORM_NAME[platform]} CLI`);
  const auth = await checkCliAuth(platform, origin.host);
  switch (auth.kind) {
    case "missing":
      spin.error(`\`${auth.bin}\` not found in PATH`);
      p.cancel(`Install \`${auth.bin}\`, then run \`lgtm init\` again.`);
      return 1;
    case "logged-out":
      spin.error(`\`${auth.bin}\` is not logged in to ${origin.host}`);
      p.cancel(`Run \`${auth.bin} auth login --hostname ${origin.host}\`, then \`lgtm init\` again.`);
      return 1;
    case "ok":
      spin.stop(`\`${auth.bin}\` logged in to ${origin.host}`);
  }

  const { model } = await readUserConfig();
  spin.start(`Asking agent${model ? ` (${model})` : ""} about this project`);
  try {
    const { result, duration_ms } = await runAgent(SUMMARY_PROMPT, { cwd, model, mode: "ask" });
    spin.stop(`Agent answered in ${(duration_ms / 1000).toFixed(1)}s`);
    p.note(result.trim(), "Project summary");
  } catch (err) {
    spin.error("Agent failed");
    p.cancel((err as Error).message);
    return 1;
  }

  p.outro("Done");
  return 0;
}
