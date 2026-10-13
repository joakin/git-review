import { useEffect, useRef, useState } from "preact/hooks";
import type { Project } from "@git-review/shared/api";
import { checkFeedbackSources } from "./feedback-check-api.ts";
import {
  isSelectionSubject,
  commentSourceLineCount,
  commentLineAnchors,
  canReattachAnchor,
  maxDrafts,
  newLocalId,
  readCommentStore,
  saveCommentStore,
  undoSuccessfulCopy,
  type CommentAnchor,
  type CommentTarget,
  type CommentStore,
  type DraftComment,
} from "./comments.ts";
import { maxFeedbackCheckLines } from "@git-review/shared/feedback-check";
import { FeedbackTransactions, type FeedbackState } from "./feedback-transactions.ts";
import type { NotificationSeverity } from "./notification-store.ts";
import { useNotification } from "./Notifications.tsx";

export type EditorState = CommentTarget & { draftId: string | null; body: string };

type FeedbackSession = {
  store: CommentStore | null;
  editor: EditorState | null;
  previewOpen: boolean;
  undoCopyId: string | null;
  undoError: string | null;
  reattachId: string | null;
};

type FeedbackPreview = {
  store: CommentStore;
  projectPath: string;
  state: FeedbackState;
  canUndo: boolean;
};

type FeedbackModel = {
  drafts: readonly DraftComment[];
  editor: EditorState | null;
  preview: FeedbackPreview | null;
  reattachment: CommentTarget | null;
};

type FeedbackActions = {
  prepareNavigation: () => void;
  beginProjectOpen: () => void;
  loadProject: (project: Project) => void;
  chooseLine: (anchor: CommentAnchor) => void;
  chooseSelection: (target: CommentTarget) => void;
  changeBody: (body: string) => void;
  closeEditor: () => void;
  deleteEditor: () => void;
  openPreview: () => void;
  closePreview: () => void;
  editDraft: (id: string) => void;
  reattachDraft: (id: string) => void;
  cancelReattachment: () => void;
  check: () => void;
  copy: () => void;
  undo: () => void;
  copyHistory: (text: string) => void;
};

type FeedbackOwner = { model: FeedbackModel; actions: FeedbackActions };
type FeedbackInputs = {
  project: Project | null;
  onNotice: (message: string, severity?: NotificationSeverity) => void;
  onRevealAnchor: (anchor: CommentAnchor) => void;
};

const emptySession: FeedbackSession = {
  store: null,
  editor: null,
  previewOpen: false,
  undoCopyId: null,
  undoError: null,
  reattachId: null,
};

/** Owns the loaded feedback session and an App-lifetime transaction engine. */
export function useReviewFeedback(inputs: FeedbackInputs): FeedbackOwner {
  const inputsRef = useRef(inputs);
  inputsRef.current = inputs;
  const [session, setSession] = useState<FeedbackSession>(emptySession);
  const sessionRef = useRef(session);
  const [state, setState] = useState<FeedbackState>({
    check: { kind: "idle" },
    copy: { kind: "idle" },
  });

  function updateSession(change: (current: FeedbackSession) => FeedbackSession): void {
    const next = change(sessionRef.current);
    sessionRef.current = next;
    setSession(next);
  }

  function updateStore(change: (current: CommentStore) => CommentStore): CommentStore | null {
    const current = sessionRef.current.store;
    if (current === null) return null;
    const next = change(current);
    if (next !== current) {
      updateSession((value) => ({ ...value, store: next }));
      saveCommentStore(next);
    }
    return next;
  }

  const transactionsRef = useRef<FeedbackTransactions | null>(null);
  if (transactionsRef.current === null)
    transactionsRef.current = new FeedbackTransactions({
      readStore: () => sessionRef.current.store,
      updateStore,
      onState: setState,
      onCopied: (result) => {
        if (result.kind === "feedback") {
          updateSession((current) => ({ ...current, undoCopyId: result.id, undoError: null }));
          inputsRef.current.onNotice(
            "Feedback copied. The copied comments are in history; Undo restores them.",
            "success",
          );
        } else inputsRef.current.onNotice("History feedback copied.", "success");
      },
      checkAnchors: checkFeedbackSources,
      writeText: async (text) => {
        if (navigator.clipboard?.writeText === undefined)
          throw new Error(
            "Clipboard access is unavailable here. Select the feedback or history text to copy it manually.",
          );
        await navigator.clipboard.writeText(text);
      },
    });
  const transactions = transactionsRef.current;
  useEffect(() => () => transactions.cancel(), [transactions]);

  function closeEditor(): void {
    const editor = sessionRef.current.editor;
    if (editor !== null && editor.body.trim().length > 0)
      updateStore((current) => {
        const now = Date.now();
        if (editor.draftId !== null)
          return {
            ...current,
            drafts: current.drafts.map((draft) =>
              draft.id === editor.draftId
                ? { ...draft, body: editor.body.trim(), updatedAt: now }
                : draft,
            ),
          };
        if (
          commentSourceLineCount(current.drafts) + commentLineAnchors(editor).length >
          maxFeedbackCheckLines
        ) {
          inputsRef.current.onNotice(
            "This project has reached its saved source-line limit. Copy or remove some drafts before adding this range.",
          );
          return current;
        }
        if (current.drafts.length >= maxDrafts) {
          inputsRef.current.onNotice(`This project has reached the ${maxDrafts} comment limit.`);
          return current;
        }
        const draft: DraftComment = {
          id: newLocalId(),
          anchor: editor.anchor,
          subject: editor.subject,
          body: editor.body.trim(),
          createdAt: now,
          updatedAt: now,
          state: "current",
        };
        return { ...current, drafts: [...current.drafts, draft] };
      });
    updateSession((current) => ({ ...current, editor: null }));
  }

  function prepareNavigation(): void {
    transactions.cancel();
    // Save into the old store synchronously, before App changes its destination.
    closeEditor();
    updateSession((current) => ({ ...current, previewOpen: false }));
  }

  function beginProjectOpen(): void {
    transactions.cancel();
    updateSession((current) => ({
      ...current,
      editor: null,
      previewOpen: false,
      reattachId: null,
    }));
  }

  function loadProject(project: Project): void {
    updateSession(() => ({
      ...emptySession,
      store: readCommentStore(project.absolutePath, inputsRef.current.onNotice),
    }));
  }

  function chooseLine(anchor: CommentAnchor): void {
    chooseSelection({ anchor, subject: { kind: "line" } });
  }

  function chooseSelection({ anchor, subject }: CommentTarget): void {
    if (sessionRef.current.store?.projectPath !== inputsRef.current.project?.absolutePath) return;
    const id = sessionRef.current.reattachId;
    if (id !== null) {
      const draft = currentDraft(id);
      if (draft === null) return;
      if (!canReattachAnchor(draft.anchor, anchor)) {
        inputsRef.current.onNotice(
          "Choose a line from the same feedback source, or cancel reattachment to add a new comment.",
        );
        return;
      }
      if (isSelectionSubject(draft.subject) !== isSelectionSubject(subject)) {
        inputsRef.current.onNotice(
          isSelectionSubject(draft.subject)
            ? "Select a fresh fragment, then Comment to reattach this selection."
            : "Choose a line, then Comment to reattach this line comment.",
        );
        return;
      }
      const nextDrafts =
        sessionRef.current.store?.drafts.map((current) =>
          current.id === id ? { ...current, anchor, subject } : current,
        ) ?? [];
      if (commentSourceLineCount(nextDrafts) > maxFeedbackCheckLines) {
        inputsRef.current.onNotice(
          "This range would exceed the project's saved source-line limit. Remove some drafts and retry.",
        );
        return;
      }
      updateStore((current) => ({
        ...current,
        drafts: current.drafts.map((draft) =>
          draft.id === id
            ? { ...draft, anchor, subject, state: "current", updatedAt: Date.now() }
            : draft,
        ),
      }));
      updateSession((current) => ({ ...current, reattachId: null }));
      inputsRef.current.onNotice(
        "Comment reattached. Open Feedback to check the new line before copying.",
        "success",
      );
      return;
    }
    const current = sessionRef.current.store;
    if (current === null) return;
    if (
      current.drafts.length >= maxDrafts ||
      commentSourceLineCount(current.drafts) + commentLineAnchors({ anchor, subject }).length >
        maxFeedbackCheckLines
    ) {
      inputsRef.current.onNotice(
        "This project has reached its feedback capacity. Copy or remove some drafts before adding this comment.",
      );
      return;
    }
    updateSession((current) => ({
      ...current,
      editor: { anchor, subject, draftId: null, body: "" },
    }));
  }

  function changeBody(body: string): void {
    updateSession((current) =>
      current.editor === null ? current : { ...current, editor: { ...current.editor, body } },
    );
  }

  function deleteEditor(): void {
    const id = sessionRef.current.editor?.draftId;
    if (id !== undefined && id !== null)
      updateStore((current) => ({
        ...current,
        drafts: current.drafts.filter((draft) => draft.id !== id),
      }));
    updateSession((current) => ({ ...current, editor: null }));
  }

  function check(): void {
    const project = inputsRef.current.project;
    if (project !== null) void transactions.check(project);
  }

  function openPreview(): void {
    if (inputsRef.current.project === null) return;
    updateSession((current) => ({ ...current, previewOpen: true }));
    check();
  }

  function closePreview(): void {
    // Dismissal alone allows an issued copy to finish and remain undoable.
    updateSession((current) => ({ ...current, previewOpen: false }));
  }

  function currentDraft(id: string): DraftComment | null {
    const store = sessionRef.current.store;
    return store !== null && store.projectPath === inputsRef.current.project?.absolutePath
      ? (store.drafts.find((draft) => draft.id === id) ?? null)
      : null;
  }

  function editDraft(id: string): void {
    const draft = currentDraft(id);
    if (draft === null) return;
    transactions.cancel();
    updateSession((current) => ({
      ...current,
      previewOpen: false,
      editor: { anchor: draft.anchor, subject: draft.subject, draftId: draft.id, body: draft.body },
    }));
  }

  function reattachDraft(id: string): void {
    const draft = currentDraft(id);
    if (draft === null) return;
    updateSession((current) => ({ ...current, previewOpen: false, reattachId: draft.id }));
    inputsRef.current.onRevealAnchor(draft.anchor);
  }

  function cancelReattachment(): void {
    updateSession((current) => ({ ...current, reattachId: null }));
  }

  function copy(): void {
    const project = inputsRef.current.project;
    if (project !== null) void transactions.copy(project);
  }

  function copyHistory(text: string): void {
    const project = inputsRef.current.project;
    if (project !== null) void transactions.copyHistory(project, text);
  }

  function undo(): void {
    const { undoCopyId: id, store: before } = sessionRef.current;
    if (id === null) return;
    const restored = updateStore((current) => undoSuccessfulCopy(current, id));
    if (restored === before) {
      if (before?.history[0]?.id === id)
        updateSession((current) => ({
          ...current,
          undoError:
            "Undo would exceed the project's comment or saved source-line limit. Remove a draft and try again.",
        }));
      return;
    }
    updateSession((current) => ({ ...current, undoCopyId: null, undoError: null }));
    inputsRef.current.onNotice("Copied comments restored to your draft.", "success");
  }

  const store = session.store?.projectPath === inputs.project?.absolutePath ? session.store : null;
  useNotification(
    `feedback-check:${store?.projectPath}`,
    store !== null && state.check.kind === "error"
      ? {
          message: state.check.message,
          severity: "error",
          action: { label: "Retry", run: check, disabled: state.copy.kind === "copying" },
        }
      : null,
  );
  useNotification(
    `feedback-copy:${store?.projectPath}`,
    store !== null && state.copy.kind === "error"
      ? {
          message: state.copy.message,
          severity: "error",
          ...(!session.previewOpen ? { action: { label: "Open Feedback", run: openPreview } } : {}),
        }
      : null,
  );
  useNotification(
    `feedback-undo:${store?.projectPath}`,
    store !== null && session.undoError !== null
      ? {
          message: session.undoError,
          severity: "error",
          action: { label: "Retry Undo", run: undo },
        }
      : null,
  );
  return {
    model: {
      drafts: store?.drafts ?? [],
      editor: session.editor,
      preview:
        session.previewOpen && store !== null && inputs.project !== null
          ? {
              store,
              projectPath: inputs.project.absolutePath,
              state,
              canUndo: session.undoCopyId !== null && store.history[0]?.id === session.undoCopyId,
            }
          : null,
      reattachment: store?.drafts.find((draft) => draft.id === session.reattachId) ?? null,
    },
    actions: {
      prepareNavigation,
      beginProjectOpen,
      loadProject,
      chooseLine,
      chooseSelection,
      changeBody,
      closeEditor,
      deleteEditor,
      openPreview,
      closePreview,
      editDraft,
      reattachDraft,
      cancelReattachment,
      check,
      copy,
      undo,
      copyHistory,
    },
  };
}
