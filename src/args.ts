export function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
}

export function flags(args: string[], name: string): string[] {
  return args.flatMap((arg, i) => (arg === `--${name}` && args[i + 1] ? [args[i + 1] as string] : []));
}

export function unknownFlag(args: string[], accepted: string[]): string | undefined {
  return args.find((arg) => arg.startsWith("--") && !accepted.includes(arg.slice(2)));
}
