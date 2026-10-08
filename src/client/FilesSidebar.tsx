import type { FileTree, FileTreeEntry } from "../shared/api.ts";
import { DelayedLoading } from "./DelayedLoading.tsx";
import { Chevron, Icon } from "./Icons.tsx";
import type { LoadState } from "./load-state.ts";
import { useNotification } from "./Notifications.tsx";

type FilesSidebarProps = {
  directory: string;
  selectedPath: string | null;
  state: LoadState<FileTree>;
  loadingKey: string;
  onParent: () => void;
  onSelect: (entry: FileTreeEntry) => void;
  onRetry: () => void;
};

export function FilesSidebar({
  directory,
  selectedPath,
  state,
  loadingKey,
  onParent,
  onSelect,
  onRetry,
}: FilesSidebarProps) {
  useNotification(
    `files:${loadingKey}`,
    state.kind === "error"
      ? { message: state.message, severity: "error", action: { label: "Retry", run: onRetry } }
      : null,
  );
  return (
    <div class="sidebar-files">
      {directory !== "" && (
        <div class="file-tree-breadcrumb">
          <button
            class="back-button"
            type="button"
            aria-label="Go to parent directory"
            onClick={onParent}
          >
            <Icon name="back" />
          </button>
          <span title={directory}>/{directory}</span>
        </div>
      )}
      {state.kind === "loading" && (
        <DelayedLoading key={loadingKey} className="sidebar-message" message="Loading files…" />
      )}
      {state.kind === "error" && <p class="sidebar-message">Directory unavailable.</p>}
      {state.kind === "ready" && state.value.entries.length === 0 && (
        <p class="sidebar-message">This directory is empty.</p>
      )}
      {state.kind === "ready" && (
        <div class="file-tree-list">
          {state.value.entries.map((entry) => (
            <button
              class={`file-tree-row${selectedPath === entry.path ? " file-tree-row-selected" : ""}`}
              type="button"
              key={entry.path}
              onClick={() => onSelect(entry)}
              title={entry.path}
            >
              <span class="file-tree-icon">
                <Icon
                  name={
                    entry.kind === "directory"
                      ? "folder"
                      : entry.kind === "symlink"
                        ? "link"
                        : entry.kind === "other"
                          ? "other"
                          : "file"
                  }
                />
              </span>
              <span>{entry.name}</span>
              {entry.kind === "directory" && (
                <span class="row-arrow" aria-hidden="true">
                  <Chevron />
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
