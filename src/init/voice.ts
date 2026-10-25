import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as p from "@clack/prompts";
import { USER_DIR, USER_VOICE_PATH } from "../config.js";

const TONES = {
  direct: "Direct and neutral. State the problem and the fix, no softening.",
  friendly: "Friendly and collaborative. Phrase points as suggestions and explain the reasoning briefly.",
  formal: "Formal and precise. Complete sentences, no casual language.",
};

const LENGTHS = {
  short: "One or two sentences per comment.",
  medium: "A short paragraph per comment: the problem, why it matters, the fix.",
  detailed: "Detailed comments with context and, when useful, an example.",
};

export async function askVoice(): Promise<string | symbol> {
  const answers = await p.group(
    {
      language: () => p.text({ message: "Language for review comments", initialValue: "English" }),
      tone: () =>
        p.select<keyof typeof TONES>({
          message: "Tone",
          options: [
            { value: "direct", label: "Direct", hint: "state problem and fix" },
            { value: "friendly", label: "Friendly", hint: "suggestions with reasoning" },
            { value: "formal", label: "Formal", hint: "precise, complete sentences" },
          ],
        }),
      length: () =>
        p.select<keyof typeof LENGTHS>({
          message: "Comment length",
          options: [
            { value: "short", label: "Short", hint: "1–2 sentences" },
            { value: "medium", label: "Medium", hint: "a short paragraph" },
            { value: "detailed", label: "Detailed", hint: "context and examples" },
          ],
        }),
      labels: () => p.confirm({ message: "Prefix comments with labels like `nit:` and `blocking:`?" }),
      footer: () => p.confirm({ message: "Add an AI-assisted footer to each comment?", initialValue: false }),
    },
    { onCancel: () => p.cancel("Init cancelled.") },
  );
  if (p.isCancel(answers)) return answers;

  return [
    "# Review voice",
    "",
    `- Language: write every comment in ${answers.language}.`,
    `- Tone: ${TONES[answers.tone]}`,
    `- Length: ${LENGTHS[answers.length]}`,
    answers.labels
      ? "- Labels: start each comment with its severity label (`blocking:`, `major:`, `minor:`, `nit:`)."
      : "- Labels: don't prefix comments with severity labels.",
    answers.footer ? "- Footer: end each comment with `_AI-assisted review_`." : "- Footer: none.",
    "",
  ].join("\n");
}

export async function readVoice(): Promise<string | null> {
  try {
    return await readFile(USER_VOICE_PATH, "utf8");
  } catch {
    return null;
  }
}

export async function writeVoice(content: string): Promise<void> {
  await mkdir(USER_DIR, { recursive: true });
  await writeFile(USER_VOICE_PATH, content.endsWith("\n") ? content : `${content}\n`);
}
