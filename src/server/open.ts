import { spawn } from "node:child_process";

const OPENERS: Partial<Record<NodeJS.Platform, [bin: string, args: string[]]>> = {
  darwin: ["open", []],
  win32: ["cmd", ["/c", "start", ""]],
};

export function openUrl(url: string): Promise<boolean> {
  const [bin, args] = OPENERS[process.platform] ?? ["xdg-open", []];
  return new Promise((resolve) => {
    const child = spawn(bin, [...args, url], { stdio: "ignore", detached: true });
    child.on("error", () => resolve(false));
    child.on("spawn", () => {
      child.unref();
      resolve(true);
    });
  });
}
