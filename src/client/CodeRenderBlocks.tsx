import type { ComponentChildren } from "preact";

const blockLines = 64;

/** Bound browser rendering work inside a long file without removing any source rows. */
export function CodeRenderBlocks({ children }: { children: ComponentChildren[] }) {
  return (
    <>
      {Array.from({ length: Math.ceil(children.length / blockLines) }, (_, index) => {
        const lines = children.slice(index * blockLines, (index + 1) * blockLines);
        return (
          <div class="code-render-block" style={{ "--code-block-rows": lines.length }} key={index}>
            {lines}
          </div>
        );
      })}
    </>
  );
}
