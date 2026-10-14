import type { DirectoryListing, RootInfo } from "@git-review/shared/api";
import { DelayedLoading } from "./DelayedLoading.tsx";
import { folderName } from "./folder-name.ts";
import { Chevron, Icon } from "./Icons.tsx";
import type { LoadState } from "./load-state.ts";
import { useNotification } from "./Notifications.tsx";

type ProjectPickerProps = {
  host: { endpoint: string; label: string };
  root: LoadState<RootInfo>;
  listing: LoadState<DirectoryListing>;
  path: string;
  opening: boolean;
  recentPaths: readonly string[];
  onBrowseDirectory: (path: string) => void;
  onSelectFolder: (path: string) => void;
};

export function ProjectPicker({
  host,
  root,
  listing,
  path,
  opening,
  recentPaths,
  onBrowseDirectory,
  onSelectFolder,
}: ProjectPickerProps) {
  useNotification(
    `folders:${path}`,
    listing.kind === "error" && root.kind !== "error"
      ? {
          message: listing.message,
          severity: "error",
          action: { label: "Back to root", run: () => onBrowseDirectory("") },
        }
      : null,
  );
  const rootLabel = root.kind === "ready" ? root.value.label : "Host folders";
  const folderLabel = listing.kind === "ready" ? folderName(listing.value.path) : folderName(path);
  return (
    <>
      <div class="root-card">
        <span class="root-dot" aria-hidden="true" />
        <div class="root-copy">
          <strong>{host.label}</strong>
          <span>{host.endpoint}</span>
          {root.kind === "ready" ? (
            <span>
              {rootLabel} · {root.value.path}
            </span>
          ) : root.kind === "error" ? (
            <span>Host unavailable.</span>
          ) : (
            <DelayedLoading className="root-loading" message="Connecting to this host…" />
          )}
        </div>
      </div>

      <div class="folder-location">
        <span class="section-label">CURRENT FOLDER</span>
        <div class="folder-name-row">
          {listing.kind === "ready" && listing.value.parentPath !== null && (
            <button
              class="back-button"
              type="button"
              aria-label="Go to parent folder"
              onClick={() => onBrowseDirectory(listing.value.parentPath ?? "")}
            >
              <Icon name="back" />
            </button>
          )}
          <strong title={path}>{folderLabel}</strong>
        </div>
        <span class="folder-path">{path === "" ? "/" : `/${path}`}</span>
        <button
          class="open-button"
          type="button"
          disabled={root.kind !== "ready" || listing.kind !== "ready" || opening}
          onClick={() => onSelectFolder(path)}
        >
          {opening ? "Opening…" : "Open this folder"} <span aria-hidden="true">↗</span>
        </button>
      </div>

      <div class="folder-list-section">
        <div class="section-heading">
          <span class="section-label">SUBFOLDERS</span>
          <span>{listing.kind === "ready" ? listing.value.entries.length : ""}</span>
        </div>
        {listing.kind === "loading" && (
          <DelayedLoading key={path} className="sidebar-message" message="Loading folders…" />
        )}
        {listing.kind === "error" && <p class="sidebar-message">Folders unavailable.</p>}
        {listing.kind === "ready" && listing.value.entries.length === 0 && (
          <p class="sidebar-message">No subfolders here.</p>
        )}
        {listing.kind === "ready" &&
          listing.value.entries.map((entry) => (
            <button
              class="folder-row"
              type="button"
              key={entry.path}
              onClick={() => onBrowseDirectory(entry.path)}
            >
              <span class="folder-glyph">
                <Icon name="folder" />
              </span>
              <span class="folder-row-name">{entry.name}</span>
              <span class="row-arrow" aria-hidden="true">
                <Chevron />
              </span>
            </button>
          ))}
      </div>

      {recentPaths.length > 0 && (
        <div class="recent-section">
          <span class="section-label">RECENT FOLDERS</span>
          {recentPaths.map((recentPath) => (
            <button
              class="recent-row"
              type="button"
              key={recentPath}
              onClick={() => onSelectFolder(recentPath)}
            >
              <span aria-hidden="true">↺</span>
              <span>
                <strong>{folderName(recentPath)}</strong>
                <small>{recentPath === "" ? "/" : `/${recentPath}`}</small>
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

export function ProjectWelcome({ onBrowseFolders }: { onBrowseFolders: () => void }) {
  return (
    <div class="welcome">
      <div class="hero-orb" aria-hidden="true">
        <span>⌁</span>
      </div>
      <p class="eyebrow">A CLEARER WAY TO REVIEW</p>
      <h1>Start with a folder.</h1>
      <p class="welcome-copy">
        Choose a folder on the selected host to make it your review workspace.
      </p>
      <button class="primary-action" type="button" onClick={onBrowseFolders}>
        Browse host folders <span aria-hidden="true">→</span>
      </button>
      <div class="welcome-foot">
        <span class="line-decor" aria-hidden="true" /> Staged, unstaged, and untracked changes will
        live here.
      </div>
    </div>
  );
}
