import { access, readFile } from "node:fs/promises";
import { relative } from "node:path";
import * as p from "@clack/prompts";
import { readUserConfig, USER_VOICE_PATH } from "../config.js";
import { repoRoot as findRepoRoot } from "../git/repo.js";
import { printRules, proposeRules, writeRules } from "../init/rules.js";
import { collectSources } from "../init/sources.js";
import { askVoice, readVoice, writeVoice } from "../init/voice.js";
import { projectPath } from "../project.js";
import { connect } from "./connect.js";

export interface InitOptions {
  sources: string[];
  voiceFile?: string;
  remote?: string;
  token?: string;
}

export async function init({ sources: extraSources, voiceFile, remote, token }: InitOptions): Promise<number> {
  p.intro("lgtm init");
  const root = await findRepoRoot();
  if (!root) {
    p.cancel("Run `lgtm init` inside a git repository.");
    return 1;
  }

  const rulesStep = await initRules(root, extraSources);
  if (rulesStep !== 0) return rulesStep;

  const voiceStep = await initVoice(voiceFile);
  if (voiceStep !== 0) return voiceStep;

  const connectStep = await connect({ remote, token, standalone: false });
  if (connectStep !== 0) return connectStep;

  p.outro("lgtm is ready. Run `lgtm review --mr <id>`.");
  return 0;
}

async function initRules(root: string, extraSources: string[]): Promise<number> {
  const rulesPath = projectPath(root, "rules.yaml");
  if (await exists(rulesPath)) {
    const replace = await p.confirm({ message: ".lgtm/rules.yaml exists. Propose new rules and replace it?", initialValue: false });
    if (p.isCancel(replace)) return cancelled();
    if (!replace) {
      p.log.info("Keeping .lgtm/rules.yaml");
      return 0;
    }
  }

  const sources = await collectSources(root, extraSources);
  if (!sources.length) {
    p.log.warn("No review context files found (AGENTS.md, CLAUDE.md, CONTRIBUTING.md, lint configs…). Skipping rules.");
    return 0;
  }
  p.log.info(`Sources:\n${sources.map((s) => `  ${s.path}${s.content === null ? " (path only, too large)" : ""}`).join("\n")}`);

  const { model } = await readUserConfig();
  const spin = p.spinner();
  spin.start(`Proposing rules with ${model ?? "default model"}`);
  let proposal;
  try {
    proposal = await proposeRules(sources, root, model);
  } catch (err) {
    spin.error("Couldn't propose rules");
    p.cancel((err as Error).message);
    return 1;
  }
  const seconds = (proposal.ledger.reduce((sum, e) => sum + e.durationMs, 0) / 1000).toFixed(1);
  spin.stop(`${proposal.rules.length} rules proposed in ${seconds}s`);
  if (!proposal.rules.length) return 0;

  printRules(proposal.rules);
  const write = await p.confirm({ message: `Write these ${proposal.rules.length} rules to .lgtm/rules.yaml?` });
  if (p.isCancel(write)) return cancelled();
  if (!write) {
    p.log.info("Rules not written.");
    return 0;
  }
  const written = await writeRules(root, proposal.rules);
  p.log.success(`Wrote ${relative(root, written)}`);
  return 0;
}

async function initVoice(voiceFile?: string): Promise<number> {
  if (voiceFile) {
    await writeVoice(await readFile(voiceFile, "utf8"));
    p.log.success(`Voice copied from ${voiceFile} to ${USER_VOICE_PATH}`);
    return 0;
  }
  if (await readVoice()) {
    const redo = await p.confirm({ message: `Keep your voice in ${USER_VOICE_PATH}?` });
    if (p.isCancel(redo)) return cancelled();
    if (redo) return 0;
  }
  const voice = await askVoice();
  if (typeof voice !== "string") return 1;
  await writeVoice(voice);
  p.log.success(`Saved ${USER_VOICE_PATH}`);
  return 0;
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

function cancelled(): number {
  p.cancel("Init cancelled.");
  return 1;
}
