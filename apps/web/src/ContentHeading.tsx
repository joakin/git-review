import type { ComponentChildren } from "preact";
import { Icon } from "./Icons.tsx";

export function ContentHeading({
  title,
  onBack,
  children,
}: {
  title: string;
  onBack?: () => void;
  children?: ComponentChildren;
}) {
  return (
    <div class="changes-heading">
      <div class="content-heading-title">
        {onBack !== undefined && (
          <button class="content-back" type="button" aria-label="Open list" onClick={onBack}>
            <Icon name="back" />
          </button>
        )}
        <h2>{title}</h2>
      </div>
      {children !== undefined && children !== null && <div class="changes-actions">{children}</div>}
    </div>
  );
}
