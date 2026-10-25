export interface Model {
  id: string;
  name: string;
  isDefault: boolean;
}

const MODEL_LINE = /^(\S+) - (.+)$/;
const DEFAULT_SUFFIX = /\s*\(default\)$/i;

export function parseModels(output: string): Model[] {
  return output.split("\n").flatMap((line) => {
    const [, id, rawName] = MODEL_LINE.exec(line.trim()) ?? [];
    if (!id || !rawName) return [];
    const name = rawName.replace(/[​-‍﻿]/g, "").replace(/\s+/g, " ").trim();
    return [{ id, name: name.replace(DEFAULT_SUFFIX, ""), isDefault: DEFAULT_SUFFIX.test(name) }];
  });
}
