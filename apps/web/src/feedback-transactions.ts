import type { Project } from "@git-review/shared/api";
import type { FeedbackSourceChecker } from "./feedback-check-api.ts";
import { feedbackAnchorKey, type FeedbackAnchor } from "@git-review/shared/feedback-check";
import {
  commentCheckAnchor,
  maxFeedbackLength,
  mergeCheckedComments,
  newLocalId,
  recordSuccessfulCopy,
  snapshotFeedback,
  type CheckedComments,
  type CommentStore,
} from "./comments.ts";

type CheckState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "ready"; checked: CheckedComments }
  | { kind: "error"; message: string };
type CopyState = { kind: "idle" } | { kind: "copying" } | { kind: "error"; message: string };
export type FeedbackState = { check: CheckState; copy: CopyState };
type CopyResult = { kind: "feedback"; id: string } | { kind: "history" };

type FeedbackPorts = {
  readStore: () => CommentStore | null;
  updateStore: (change: (current: CommentStore) => CommentStore) => CommentStore | null;
  onState: (state: FeedbackState) => void;
  onCopied: (result: CopyResult) => void;
  checkAnchors: FeedbackSourceChecker;
  writeText: (text: string, owns: () => boolean) => Promise<void>;
};

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong";
}

/** Owns request cancellation, current-store merges, and the uncancellable clipboard lease. */
export class FeedbackTransactions {
  private generation = 0;
  private request: AbortController | null = null;
  private clipboardLease: { generation: number } | null = null;
  private checkState: CheckState = { kind: "idle" };
  private copyState: CopyState = { kind: "idle" };

  constructor(private readonly ports: FeedbackPorts) {}

  private publish(): void {
    this.ports.onState({ check: this.checkState, copy: this.copyState });
  }

  cancel(): void {
    this.generation += 1;
    this.request?.abort();
    this.request = null;
    this.checkState = { kind: "idle" };
    // An issued clipboard write cannot be aborted; keep its lease until it settles.
    this.copyState = this.clipboardLease === null ? { kind: "idle" } : { kind: "copying" };
    this.publish();
  }

  private beginCheck(): { generation: number; signal: AbortSignal } {
    this.request?.abort();
    this.request = new AbortController();
    this.generation += 1;
    this.checkState = { kind: "checking" };
    this.copyState = { kind: "idle" };
    return { generation: this.generation, signal: this.request.signal };
  }

  private owns(generation: number, projectPath: string): boolean {
    return generation === this.generation && this.ports.readStore()?.projectPath === projectPath;
  }

  private async checkSnapshot(
    snapshot: CommentStore,
    signal: AbortSignal,
  ): Promise<CheckedComments> {
    const anchors: FeedbackAnchor[] = [];
    const indices = new Map<string, number>();
    for (const draft of snapshot.drafts) {
      const anchor = commentCheckAnchor(draft);
      const key = feedbackAnchorKey(anchor);
      if (!indices.has(key)) {
        indices.set(key, anchors.length);
        anchors.push(anchor);
      }
    }
    const matches =
      anchors.length === 0
        ? []
        : await this.ports.checkAnchors(snapshot.projectPath, anchors, signal);
    signal.throwIfAborted();
    return {
      projectPath: snapshot.projectPath,
      drafts: snapshot.drafts.map((draft) => {
        const index = indices.get(feedbackAnchorKey(commentCheckAnchor(draft)));
        return {
          id: draft.id,
          anchor: draft.anchor,
          subject: draft.subject,
          state: index !== undefined && matches[index] === true ? "current" : "outdated",
        };
      }),
    };
  }

  async check(project: Project): Promise<void> {
    if (this.clipboardLease?.generation === this.generation) return;
    const snapshot = this.ports.readStore();
    if (snapshot?.projectPath !== project.absolutePath) return;
    const token = this.beginCheck();
    // A canceled write from a previous destination may still own the clipboard.
    if (this.clipboardLease !== null) this.copyState = { kind: "copying" };
    this.publish();
    try {
      const checked = await this.checkSnapshot(snapshot, token.signal);
      if (!this.owns(token.generation, project.absolutePath)) return;
      this.ports.updateStore((current) => mergeCheckedComments(current, checked));
      this.checkState = { kind: "ready", checked };
      this.publish();
    } catch (error: unknown) {
      if (!this.owns(token.generation, project.absolutePath)) return;
      this.checkState = { kind: "error", message: message(error) };
      this.publish();
    }
  }

  async copy(project: Project): Promise<void> {
    if (this.clipboardLease !== null) return;
    const initial = this.ports.readStore();
    if (initial?.projectPath !== project.absolutePath) return;
    const token = this.beginCheck();
    this.clipboardLease = { generation: token.generation };
    this.copyState = { kind: "copying" };
    this.publish();
    let phase: "check" | "copy" = "check";
    try {
      const checked = await this.checkSnapshot(initial, token.signal);
      if (!this.owns(token.generation, project.absolutePath)) return;
      const current = this.ports.updateStore((store) => mergeCheckedComments(store, checked));
      if (current === null) return;
      this.checkState = { kind: "ready", checked };
      phase = "copy";
      const snapshot = snapshotFeedback(project.absolutePath, current, checked);
      if (snapshot.text.length === 0)
        throw new Error("No current comments to copy. Reattach outdated comments first.");
      if (snapshot.text.length > maxFeedbackLength)
        throw new Error(
          "Feedback is too large for copy history. Select the text below to copy it manually.",
        );
      this.publish();
      await this.ports.writeText(snapshot.text, () =>
        this.owns(token.generation, project.absolutePath),
      );
      if (!this.owns(token.generation, project.absolutePath)) return;
      const id = newLocalId();
      this.ports.updateStore((store) => recordSuccessfulCopy(store, snapshot, Date.now(), id));
      this.ports.onCopied({ kind: "feedback", id });
    } catch (error: unknown) {
      if (!this.owns(token.generation, project.absolutePath)) return;
      if (phase === "check") this.checkState = { kind: "error", message: message(error) };
      else this.copyState = { kind: "error", message: message(error) };
    } finally {
      this.clipboardLease = null;
      if (this.copyState.kind === "copying") this.copyState = { kind: "idle" };
      this.publish();
    }
  }

  async copyHistory(project: Project, text: string): Promise<void> {
    if (
      this.clipboardLease !== null ||
      this.ports.readStore()?.projectPath !== project.absolutePath
    )
      return;
    const generation = this.generation;
    this.clipboardLease = { generation };
    this.copyState = { kind: "copying" };
    this.publish();
    try {
      await this.ports.writeText(text, () => this.owns(generation, project.absolutePath));
      if (this.owns(generation, project.absolutePath)) this.ports.onCopied({ kind: "history" });
    } catch (error: unknown) {
      if (this.owns(generation, project.absolutePath))
        this.copyState = { kind: "error", message: message(error) };
    } finally {
      this.clipboardLease = null;
      if (this.copyState.kind === "copying") this.copyState = { kind: "idle" };
      this.publish();
    }
  }
}
