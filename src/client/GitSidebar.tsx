import { useLayoutEffect, useRef } from "preact/hooks";
import type { GitRoute } from "./navigation.ts";
import { DelayedLoading } from "./DelayedLoading.tsx";
import type { GitRefs, GitHistoryPage } from "../shared/git.ts";
import type { GitLoad } from "./git-browser.ts";
import { CommitMeta } from "./CommitMeta.tsx";

type GitListModel = {
  refs: GitLoad<GitRefs>;
  history: GitLoad<GitHistoryPage>;
  unborn: boolean;
  refreshing: boolean;
  paging: boolean;
  pageError: string | null;
};
type GitListCommands = { refreshHistory: () => void; loadOlder: () => void };
const listScrolls = new Map<string, number>();

export function GitSidebar({ model, commands, route, onBranch, onCommit }: { model: GitListModel; commands: GitListCommands; route: GitRoute; onBranch: (ref: string) => void; onCommit: (oid: string) => void }) {
  const container = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const sidebar = container.current?.closest(".sidebar");
    const key = `${route.projectPath}\0${route.ref ?? ""}`;
    if (sidebar instanceof HTMLElement) sidebar.scrollTop = listScrolls.get(key) ?? 0;
    return () => {
      if (sidebar instanceof HTMLElement) {
        listScrolls.delete(key);
        listScrolls.set(key, sidebar.scrollTop);
        while (listScrolls.size > 64) { const oldest = listScrolls.keys().next().value; if (oldest === undefined) break; listScrolls.delete(oldest); }
      }
    };
  }, [route.projectPath, route.ref, model.refs.kind, model.history.kind]);
  const refs = model.refs;
  if (refs.kind === "loading") return <DelayedLoading className="sidebar-message" message="Reading Git history…" />;
  if (refs.kind === "error") return <div class="sidebar-error" role="alert">{refs.message} <button type="button" onClick={commands.refreshHistory}>Retry</button></div>;
  if (refs.value.kind === "not_git") return <p class="sidebar-message">This folder is not a Git worktree.</p>;
  const git = refs.value;
  const detached = git.head.kind === "detached";
  const unavailableRef = route.ref !== null && route.ref !== "HEAD" && !git.branches.some((branch) => branch.ref === route.ref) && !(git.head.kind === "unborn" && git.head.ref === route.ref);
  return <div class="git-browser-list" ref={container}>
    <div class="git-branch-controls"><label>Branch<select aria-label="Git branch" value={route.ref ?? ""} onChange={(event) => onBranch(event.currentTarget.value)}>
      {route.ref === null && <option value="" disabled>Select a branch</option>}
      {detached && <option value="HEAD">Detached HEAD · {git.head.kind === "detached" ? git.head.oid.slice(0, 8) : ""}</option>}
      {!detached && route.ref === "HEAD" && <option value="HEAD">HEAD</option>}
      {git.head.kind === "unborn" && <option value={git.head.ref}>{git.head.ref.slice(11)} · no commits</option>}
      {unavailableRef && <option value={route.ref ?? ""}>Unavailable · {route.ref?.replace(/^refs\/(heads|remotes)\//, "")}</option>}
      {(["local", "remote"] as const).map((kind) => {
        const branches = git.branches.filter((branch) => branch.kind === kind);
        return branches.length === 0 ? null : <optgroup label={kind === "local" ? "Local branches" : "Remote branches"} key={kind}>{branches.map((branch) => <option key={branch.ref} value={branch.ref}>{branch.name}</option>)}</optgroup>;
      })}
    </select></label><button class="git-refresh" type="button" disabled={model.refreshing} onClick={commands.refreshHistory}>Refresh</button></div>
    {git.scope !== "" && <p class="git-scope">History scoped to /{git.scope}</p>}
    {model.pageError !== null && <div class="sidebar-error" role="alert">{model.pageError}</div>}
    {model.unborn ? <p class="sidebar-message">This branch has no commits yet.</p> : route.ref === null ? null : model.history.kind === "loading" ? <DelayedLoading className="sidebar-message" message="Reading commits…" /> : model.history.kind === "error" ? <div class="sidebar-error" role="alert">{model.history.message} <button type="button" onClick={commands.refreshHistory}>Retry</button></div> : <>
      {model.history.value.commits.length === 0 && <p class="sidebar-message">No commits in this project scope.</p>}
      <ul class="git-commit-list">{model.history.value.commits.map((commit) => <li key={commit.oid}><button class="git-commit-row" type="button" aria-current={route.target.kind === "commit" && route.target.oid === commit.oid ? "page" : undefined} onClick={() => onCommit(commit.oid)}>
        <strong>{commit.subject || "Untitled commit"}</strong>
        <CommitMeta source={{ kind: "list", commit }} />
      </button></li>)}</ul>
      {model.history.value.nextOffset !== null && <button class="git-load-older" type="button" disabled={model.paging || model.refreshing} onClick={commands.loadOlder}>Load older</button>}
      {model.paging && <DelayedLoading className="sidebar-message" message="Reading older commits…" />}
    </>}
  </div>;
}
