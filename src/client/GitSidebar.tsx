import { useLayoutEffect, useRef } from "preact/hooks";
import type { GitRoute } from "./navigation.ts";
import { DelayedLoading } from "./DelayedLoading.tsx";
import type { useGitBrowser } from "./git-browser.ts";
import { CommitMeta } from "./CommitMeta.tsx";

export type GitBrowserState = ReturnType<typeof useGitBrowser>;
const listScrolls = new Map<string, number>();

export function GitSidebar({ browser, route, onBranch, onCommit }: { browser: GitBrowserState; route: GitRoute; onBranch: (ref: string) => void; onCommit: (oid: string) => void }) {
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
  }, [route.projectPath, route.ref, browser.refs.kind, browser.history.kind]);
  const refs = browser.refs;
  if (refs.kind === "loading") return <DelayedLoading className="sidebar-message" message="Reading Git history…" />;
  if (refs.kind === "error") return <div class="sidebar-error" role="alert">{refs.message} <button type="button" onClick={browser.refreshHistory}>Retry</button></div>;
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
    </select></label><button class="git-refresh" type="button" disabled={browser.refreshing} onClick={browser.refreshHistory}>Refresh</button></div>
    {git.scope !== "" && <p class="git-scope">History scoped to /{git.scope}</p>}
    {browser.pageError !== null && <div class="sidebar-error" role="alert">{browser.pageError}</div>}
    {browser.unborn ? <p class="sidebar-message">This branch has no commits yet.</p> : route.ref === null ? null : browser.history.kind === "loading" ? <DelayedLoading className="sidebar-message" message="Reading commits…" /> : browser.history.kind === "error" ? <div class="sidebar-error" role="alert">{browser.history.message} <button type="button" onClick={browser.refreshHistory}>Retry</button></div> : <>
      {browser.history.value.commits.length === 0 && <p class="sidebar-message">No commits in this project scope.</p>}
      <ul class="git-commit-list">{browser.history.value.commits.map((commit) => <li key={commit.oid}><button class="git-commit-row" type="button" aria-current={route.target.kind === "commit" && route.target.oid === commit.oid ? "page" : undefined} onClick={() => onCommit(commit.oid)}>
        <strong>{commit.subject || "Untitled commit"}</strong>
        <CommitMeta source={{ kind: "list", commit }} />
      </button></li>)}</ul>
      {browser.history.value.nextOffset !== null && <button class="git-load-older" type="button" disabled={browser.paging || browser.refreshing} onClick={browser.loadOlder}>Load older</button>}
      {browser.paging && <DelayedLoading className="sidebar-message" message="Reading older commits…" />}
    </>}
  </div>;
}
