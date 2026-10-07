import type { ComponentChildren } from "preact";
import { ContentHeading } from "./ContentHeading.tsx";

export type GitHeadingCommands = {
  back: () => void;
  toggleWrap: () => void;
  refresh: () => void;
};

export function GitHeading({
  title,
  wrap,
  refreshing,
  commands,
  children,
}: {
  title: "Commit" | "Git history";
  wrap: boolean;
  refreshing: boolean;
  commands: GitHeadingCommands;
  children?: ComponentChildren;
}) {
  return (
    <ContentHeading title={title} onBack={commands.back}>
      {children}
      <button type="button" aria-pressed={wrap} onClick={commands.toggleWrap}>
        {wrap ? "Wrap: on" : "Wrap: off"}
      </button>
      <button type="button" disabled={refreshing} onClick={commands.refresh}>
        Refresh
      </button>
    </ContentHeading>
  );
}
