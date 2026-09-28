import { useEffect, useRef } from "preact/hooks";
import { formatFeedback, maxBodyLength, type CommentAnchor, type CommentStore, type DraftComment } from "./comments.ts";

export type EditorState = { anchor: CommentAnchor; draftId: string | null; body: string };
export type CheckState = "checking" | "ready" | "error";

export function useModal(onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const dialog = ref.current;
    const previousBodyOverflow = document.body.style.overflow;
    const previousDocumentOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    dialog?.showModal();
    const onPointerDown = (event: PointerEvent) => {
      if (dialog === null || !dialog.open) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeRef.current();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      dialog?.close();
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousDocumentOverflow;
    };
  }, []);
  return {
    ref,
    onCancel: (event: Event) => { event.preventDefault(); onClose(); },
  };
}

function anchorLabel(anchor: CommentAnchor): string {
  return `${anchor.layer} · ${anchor.side} line ${anchor.line}`;
}

export function CommentEditor({ editor, onBody, onClose, onDelete }: { editor: EditorState; onBody: (body: string) => void; onClose: () => void; onDelete: () => void }) {
  const modal = useModal(onClose);
  return <dialog class="review-dialog comment-editor" ref={modal.ref} onCancel={modal.onCancel} aria-labelledby="comment-editor-title">
    <div class="review-dialog-head"><div><p class="eyebrow">LINE FEEDBACK</p><h2 id="comment-editor-title">{editor.draftId === null ? "Add a comment" : "Edit comment"}</h2></div><button type="button" class="review-dialog-close" aria-label="Close comment editor" onClick={onClose}>×</button></div>
    <p class="review-anchor"><strong>{editor.anchor.path}</strong><span>{anchorLabel(editor.anchor)}</span></p>
    <pre class="review-source">{editor.anchor.sourceText}</pre>
    <label class="review-field">Your feedback<textarea autofocus value={editor.body} maxLength={maxBodyLength} rows={6} placeholder="What should change?" onInput={(event) => onBody(event.currentTarget.value)} /></label>
    <div class="review-dialog-actions">{editor.draftId !== null && <button class="review-danger" type="button" onClick={onDelete}>Delete</button>}<button class="review-primary" type="button" onClick={onClose}>Save comment</button></div>
    <p class="review-hint">Closing saves non-empty text on this device.</p>
  </dialog>;
}

export function FeedbackDialog({ store, projectPath, checkState, error, copyError, onClose, onCheck, onCopy, onEdit, onReattach, onUndo, canUndo, onCopyHistory }: {
  store: CommentStore;
  projectPath: string;
  checkState: CheckState;
  error: string | null;
  copyError: string | null;
  onClose: () => void;
  onCheck: () => void;
  onCopy: () => void;
  onEdit: (draft: DraftComment) => void;
  onReattach: (draft: DraftComment) => void;
  onUndo: () => void;
  canUndo: boolean;
  onCopyHistory: (text: string) => void;
}) {
  const modal = useModal(onClose);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const current = store.drafts.filter((draft) => draft.state === "current");
  const outdated = store.drafts.filter((draft) => draft.state === "outdated");
  const exportText = formatFeedback(projectPath, current);
  return <dialog class="review-dialog feedback-dialog" ref={modal.ref} onCancel={modal.onCancel} aria-labelledby="feedback-title">
    <div class="review-dialog-head"><div><p class="eyebrow">REVIEW DRAFT</p><h2 id="feedback-title">Feedback <span class="review-count">{store.drafts.length}</span></h2></div><button type="button" class="review-dialog-close" aria-label="Close feedback" onClick={onClose}>×</button></div>
    <div class="review-dialog-content">
      {checkState === "checking" && <p class="review-status" role="status">Checking current diff lines…</p>}
      {checkState === "error" && <div class="review-error" role="alert">{error ?? "Could not check the current diff."} <button type="button" onClick={onCheck}>Retry</button></div>}
      {store.drafts.length === 0 && <p class="review-empty">Tap a line number in a diff to add feedback.</p>}
      {store.drafts.map((draft) => <article class={`review-item${draft.state === "outdated" ? " review-item-outdated" : ""}`} key={draft.id}>
        <div class="review-item-top"><strong>{draft.anchor.path}</strong><span>{anchorLabel(draft.anchor)}</span></div>
        <pre>{draft.anchor.sourceText}</pre><p>{draft.body}</p>
        {draft.state === "outdated" && <p class="review-outdated">Line changed or disappeared. Reattach before copying.</p>}
        <div class="review-item-actions"><button type="button" onClick={() => onEdit(draft)}>Edit</button>{draft.state === "outdated" && <button type="button" onClick={() => onReattach(draft)}>Reattach to line</button>}</div>
      </article>)}
      {outdated.length > 0 && <p class="review-hint">{outdated.length} outdated comment{outdated.length === 1 ? " is" : "s are"} excluded from export.</p>}
      {checkState === "ready" && current.length > 0 && <div class="review-export"><label for="review-export-text">Copyable feedback text</label><textarea id="review-export-text" ref={textRef} readOnly value={exportText} rows={8} onFocus={(event) => event.currentTarget.select()} /><button type="button" onClick={() => textRef.current?.select()}>Select text</button></div>}
      {copyError !== null && <p class="review-error" role="alert">{copyError}</p>}
      {store.history.length > 0 && <section class="review-history"><h3>Copy history</h3>{store.history.map((entry) => <details class="review-history-item" key={entry.id}><summary>{new Date(entry.copiedAt).toLocaleString()} · {entry.comments.length} comments</summary><textarea readOnly value={entry.text} rows={6} onFocus={(event) => event.currentTarget.select()} /><button type="button" onClick={() => onCopyHistory(entry.text)}>Copy again</button></details>)}</section>}
    </div>
    <div class="review-dialog-actions review-feedback-actions"><button type="button" onClick={onCheck} disabled={checkState === "checking" || store.drafts.length === 0}>Check lines</button><button type="button" onClick={onUndo} disabled={!canUndo}>Undo last copy</button><button class="review-primary" type="button" onClick={onCopy} disabled={checkState !== "ready" || current.length === 0}>Copy feedback</button></div>
  </dialog>;
}
