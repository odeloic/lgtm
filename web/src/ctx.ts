import { createContext, useContext } from "react";

export interface Actions {
  accept(id: string): Promise<boolean>;
  dismiss(id: string, reason: string): Promise<boolean>;
  reset(id: string): Promise<boolean>;
  edit(id: string, change: { body?: string; suggestion?: string }): Promise<boolean>;
  copy(id: string): Promise<boolean>;
  postComment(id: string): Promise<boolean>;
  copyText(text: string): Promise<boolean>;
  ask(id: string, message: string): Promise<boolean>;
  applyProposal(id: string): Promise<boolean>;
  ignoreProposal(id: string): Promise<boolean>;
  comment(comment: { file: string; startLine: number; endLine: number; body: string }): Promise<boolean>;
}

export interface Ctx {
  actions: Actions;
  pendingSince: Record<string, number>;
  threadErrors: Record<string, string>;
  postErrors: Record<string, string>;
  threads: boolean;
  lineText(file: string, newNo: number): string | undefined;
  fileAnchor(file: string): string | undefined;
  sourceUrl(file: string, start: number, end: number): string | undefined;
}

export const Context = createContext<Ctx | null>(null);

export function useCtx(): Ctx {
  const ctx = useContext(Context);
  if (!ctx) throw new Error("Context is missing");
  return ctx;
}
