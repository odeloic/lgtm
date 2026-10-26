import { readFile } from "node:fs/promises";
import picomatch from "picomatch";
import { parse } from "yaml";
import { projectPath } from "../project.js";
import { type Rule, RulesFile } from "../schemas.js";
import type { ReviewTree } from "./tree.js";

export interface BaseRules {
  rules: Rule[];
  warning?: string;
}

export async function loadBaseRules(
  tree: ReviewTree,
  repoRoot: string,
  targetBranch: string,
  rulesFile?: string,
): Promise<BaseRules> {
  if (rulesFile) return { rules: RulesFile.parse(parse(await readFile(rulesFile, "utf8"))).rules };
  const base = await tree.git(["show", `${tree.targetSha}:.lgtm/rules.yaml`]).catch(() => null);
  const local = await readFile(projectPath(repoRoot, "rules.yaml"), "utf8").catch(() => null);
  const rules = base === null ? [] : RulesFile.parse(parse(base)).rules;

  if (local === null || local === base) return { rules };
  const warning =
    base === null
      ? `.lgtm/rules.yaml isn't on ${targetBranch}, the MR's target branch, so this review uses no rules.`
      : `.lgtm/rules.yaml differs from ${targetBranch}, the MR's target branch. This review uses the ${targetBranch} version.`;
  return { rules, warning };
}

export function rulesForFiles(rules: Rule[], files: string[]): Rule[] {
  return rules.filter((rule) => {
    if (rule.enforcedBy) return false;
    const matches = picomatch(rule.scope, { dot: true });
    return files.some((file) => matches(file));
  });
}
