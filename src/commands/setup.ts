import * as p from "@clack/prompts";
import { INSTALL_HINT, checkAuth } from "../agent/auth.js";
import type { Model } from "../agent/models.js";
import { USER_CONFIG_PATH, readUserConfig, writeUserConfig } from "../config.js";

const LOGIN_HINT = "Run `agent login`, then `lgtm setup` again.";

export async function setup(): Promise<number> {
  p.intro("lgtm setup");

  const spin = p.spinner();
  spin.start("Checking Cursor agent");
  const auth = await checkAuth();

  switch (auth.kind) {
    case "missing":
      spin.error("Cursor agent not found in PATH");
      p.cancel(INSTALL_HINT);
      return 1;
    case "logged-out":
      spin.error(`agent ${auth.version} is not logged in`);
      p.cancel(LOGIN_HINT);
      return 1;
    case "rejected":
      spin.error(`agent ${auth.version} has a local session, but Cursor rejected it`);
      p.log.message(`status: ${auth.message}\nserver: ${auth.reason}`);
      p.cancel(LOGIN_HINT);
      return 1;
    case "ok":
      spin.stop(`agent ${auth.version} — ${auth.message}`);
  }

  const useSession = await p.confirm({ message: "Use this Cursor session for lgtm?" });
  if (p.isCancel(useSession) || !useSession) {
    p.cancel("To use a different account, run `agent logout && agent login`.");
    return 1;
  }

  if (auth.models.length === 0) {
    p.cancel("`agent models` returned no models for this account.");
    return 1;
  }

  const config = await readUserConfig();
  const model = await selectModel(auth.models, config.model, `Review model (${auth.models.length} available, type to filter)`);
  if (p.isCancel(model)) {
    p.cancel("Setup cancelled; no model saved.");
    return 1;
  }

  const verifyChoice = await selectModel(
    auth.models,
    config.verifyModel ?? SAME_AS_REVIEW,
    "Verify model (a fresh session that tries to refute each finding)",
    { value: SAME_AS_REVIEW, label: `same as review (${model})`, hint: "default" },
  );
  if (p.isCancel(verifyChoice)) {
    p.cancel("Setup cancelled; no model saved.");
    return 1;
  }
  const verifyModel = verifyChoice === SAME_AS_REVIEW ? undefined : verifyChoice;

  await writeUserConfig({ ...config, model, verifyModel });
  p.outro(`Review model: ${model}, verify model: ${verifyModel ?? model} (saved to ${USER_CONFIG_PATH})`);
  return 0;
}

const SAME_AS_REVIEW = "same-as-review";

function selectModel(
  models: Model[],
  current: string | undefined,
  message: string,
  extra?: { value: string; label: string; hint: string },
) {
  const initial =
    (current === extra?.value ? extra?.value : undefined) ??
    models.find((m) => m.id === current)?.id ??
    models.find((m) => m.isDefault)?.id ??
    models[0]?.id;

  return p.autocomplete<string>({
    message,
    options: [
      ...(extra ? [extra] : []),
      ...models.map((m) => ({
      value: m.id,
      label: m.id,
      hint: [m.name, m.isDefault && "Cursor default", m.id === current && "current"]
        .filter(Boolean)
        .join(" · "),
      })),
    ],
    initialValue: initial,
    maxItems: 10,
    filter: (search, option) => {
      const haystack = `${option.value} ${option.hint ?? ""}`.toLowerCase();
      return search.toLowerCase().split(/\s+/).every((term) => haystack.includes(term));
    },
  });
}
