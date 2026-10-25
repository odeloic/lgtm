import * as p from "@clack/prompts";
import { storeToken } from "../connect/credentials.js";
import { findToken, verifyToken } from "../connect/token.js";
import { PLATFORM_NAME, type Platform, detectPlatform } from "../git/host.js";
import { getRemote } from "../git/remote.js";
import { repoRoot as findRepoRoot } from "../git/repo.js";
import { DEFAULT_SKIP, readProjectConfig, writeProjectConfig } from "../project.js";

export interface ConnectOptions {
  remote?: string;
  token?: string;
  standalone?: boolean;
}

export async function connect({ remote = "origin", token: flagToken, standalone = true }: ConnectOptions = {}): Promise<number> {
  if (standalone) p.intro("lgtm connect");
  const root = await findRepoRoot();
  const origin = root ? await getRemote(root, remote) : null;
  if (!root || !origin) {
    p.cancel(`Run this inside a git repository with a \`${remote}\` remote.`);
    return 1;
  }

  const spin = p.spinner();
  spin.start(`Checking ${origin.host}`);
  let platform = await detectPlatform(origin.host);
  spin.stop(`${origin.host}/${origin.path}${platform ? ` (${PLATFORM_NAME[platform]})` : ""}`);
  if (!platform) {
    const choice = await p.select<Platform>({
      message: `Which platform hosts ${origin.host}?`,
      options: [
        { value: "github", label: PLATFORM_NAME.github },
        { value: "gitlab", label: PLATFORM_NAME.gitlab },
      ],
    });
    if (p.isCancel(choice)) {
      p.cancel("Connect cancelled.");
      return 1;
    }
    platform = choice;
  }

  spin.start("Looking for a token");
  const found = await findToken(platform, origin.host, flagToken);
  let user = found && (await verifyToken(platform, origin.host, found.token));
  if (found && user) {
    spin.stop(`Connected as ${user} (token from ${found.source})`);
    if (found.source === "flag") await storeToken(origin.host, found.token);
  } else {
    spin.error(found ? `The token from ${found.source} was rejected by ${origin.host}` : "No token found");
    const pasted = await p.password({
      message: `Paste a ${PLATFORM_NAME[platform]} token for ${origin.host} (read access to the API)`,
      validate: (value) => (value?.trim() ? undefined : "A token is required"),
    });
    if (p.isCancel(pasted)) {
      p.cancel("Connect cancelled.");
      return 1;
    }
    user = await verifyToken(platform, origin.host, pasted.trim());
    if (!user) {
      p.cancel(`${origin.host} rejected that token.`);
      return 1;
    }
    const store = await storeToken(origin.host, pasted.trim());
    p.log.success(`Connected as ${user} (token saved to ${store === "keychain" ? "the keychain" : "~/.lgtm/auth.json"})`);
  }

  const existing = await readProjectConfig(root);
  await writeProjectConfig(root, {
    provider: platform,
    host: origin.host,
    project: origin.path,
    remote,
    skip: existing?.skip ?? DEFAULT_SKIP,
    confirmAboveTokens: existing?.confirmAboveTokens ?? 150_000,
  });
  if (standalone) p.outro("Saved .lgtm/config.json");
  else p.log.success("Saved .lgtm/config.json");
  return 0;
}
