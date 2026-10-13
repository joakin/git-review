import type { ComponentChildren } from "preact";
import { Chevron } from "./Icons.tsx";

/** Share the closed-control arrow while retaining the native select menu and keyboard behavior. */
export function SelectControl({ children }: { children: ComponentChildren }) {
  return (
    <span class="select-control">
      {children}
      <Chevron direction="down" />
    </span>
  );
}
