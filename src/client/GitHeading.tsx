import type { ComponentChildren } from "preact";
import { Icon } from "./Icons.tsx";

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
    <div class="changes-heading">
      <div class="content-heading-title">
        <button class="content-back" type="button" aria-label="Open list" onClick={commands.back}>
          <Icon name="back" />
        </button>
        <h2>{title}</h2>
      </div>
      <div class="changes-actions">
        {children}
        <button type="button" aria-pressed={wrap} onClick={commands.toggleWrap}>
          {wrap ? "Wrap: on" : "Wrap: off"}
        </button>
        <button type="button" disabled={refreshing} onClick={commands.refresh}>
          Refresh
        </button>
      </div>
    </div>
  );
}
