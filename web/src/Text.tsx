import type { ReactNode } from "react";

const INLINE = /(`[^`]+`|\*\*[^*]+\*\*)/g;

function inline(text: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 1) return <code key={i}>{part.slice(1, -1)}</code>;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) return <strong key={i}>{part.slice(2, -2)}</strong>;
    return part;
  });
}

export function Inline({ text }: { text: string }) {
  return <>{inline(text)}</>;
}

export function Text({ text }: { text: string }) {
  const blocks = text.split(/```[^\n]*\n?/);
  return (
    <>
      {blocks.map((block, i) =>
        i % 2 ? (
          <pre key={i}>
            <code>{block.replace(/\n$/, "")}</code>
          </pre>
        ) : (
          block
            .trim()
            .split(/\n{2,}/)
            .filter(Boolean)
            .map((paragraph, j) => <p key={`${i}-${j}`}>{inline(paragraph)}</p>)
        ),
      )}
    </>
  );
}
