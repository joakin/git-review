import { useRef } from "preact/hooks";
import { maxBodyLength, snapshotFeedback, type CommentAnchor, type CommentStore } from "./comments.ts";
import { useVoiceComment, VoiceCommentFooter } from "./VoiceComment.tsx";
import type { FeedbackState } from "./feedback-transactions.ts";
import { useModal } from "./modal.ts";
import type { EditorState } from "./review-feedback.ts";

function anchorLabel(anchor: CommentAnchor): string {
  return `${anchor.layer} · ${anchor.side} line ${anchor.line}`;
}

export function CommentEditor({ editor, onBody, onClose, onDelete }: { editor: EditorState; onBody: (body: string) => void; onClose: () => void; onDelete: () => void }) {
  const modal = useModal(onClose);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const voice = useVoiceComment(textareaRef, onBody);
  return <dialog class="review-dialog comment-editor" ref={modal.ref} onCancel={modal.onCancel} aria-labelledby="comment-editor-title">
    <div class="review-dialog-head"><div><p class="eyebrow">LINE FEEDBACK</p><h2 id="comment-editor-title">{editor.draftId === null ? "Add a comment" : "Edit comment"}</h2></div><button type="button" class="review-dialog-close" aria-label="Close comment editor" onClick={onClose}>×</button></div>
    <p class="review-anchor"><strong>{editor.anchor.path}</strong><span>{anchorLabel(editor.anchor)}</span></p>
    <pre class="review-source">{editor.anchor.sourceText}</pre>
    <label class="review-field">Your feedback<textarea ref={textareaRef} autofocus value={editor.body} readOnly={voice.locked} maxLength={maxBodyLength} rows={6} placeholder="What should change?" onInput={(event) => onBody(event.currentTarget.value)} /></label>
    <VoiceCommentFooter voice={voice} />
    <div class="review-dialog-actions">{editor.draftId !== null && <button class="review-danger" type="button" onClick={onDelete}>Delete</button>}<button class="review-primary" type="button" onClick={onClose}>Save comment</button></div>
    <p class="review-hint">Closing saves non-empty text on this device.</p>
  </dialog>;
}

export function FeedbackDialog({ store, projectPath, state, undoError, onClose, onCheck, onCopy, onEdit, onReattach, onUndo, canUndo, onCopyHistory }: {
  store: CommentStore;
  projectPath: string;
  state: FeedbackState;
  undoError: string | null;
  onClose: () => void;
  onCheck: () => void;
  onCopy: () => void;
  onEdit: (id: string) => void;
  onReattach: (id: string) => void;
  onUndo: () => void;
  canUndo: boolean;
  onCopyHistory: (text: string) => void;
}) {
  const modal = useModal(onClose);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const outdated = store.drafts.filter((draft) => draft.state === "outdated");
  const exportText = state.check.kind === "ready" ? snapshotFeedback(projectPath, store, state.check.checked).text : "";
  return <dialog class="review-dialog feedback-dialog" ref={modal.ref} onCancel={modal.onCancel} aria-labelledby="feedback-title">
    <div class="review-dialog-head"><div><p class="eyebrow">REVIEW DRAFT</p><h2 id="feedback-title">Feedback <span class="review-count">{store.drafts.length}</span></h2></div><button type="button" class="review-dialog-close" aria-label="Close feedback" onClick={onClose}>×</button></div>
    <div class="review-dialog-content">
      {state.check.kind === "checking" && <p class="review-status" role="status">Checking current diff lines…</p>}
      {state.copy.kind === "copying" && state.check.kind !== "checking" && <p class="review-status" role="status">Copying feedback…</p>}
      {state.check.kind === "error" && <div class="review-error" role="alert">{state.check.message} <button type="button" onClick={onCheck} disabled={state.copy.kind === "copying"}>Retry</button></div>}
      {store.drafts.length === 0 && <p class="review-empty">Tap a code line in a diff, then choose Comment.</p>}
      {store.drafts.map((draft) => <article class={`review-item${draft.state === "outdated" ? " review-item-outdated" : ""}`} key={draft.id}>
        <div class="review-item-top"><strong>{draft.anchor.path}</strong><span>{anchorLabel(draft.anchor)}</span></div>
        <pre>{draft.anchor.sourceText}</pre><p>{draft.body}</p>
        {draft.state === "outdated" && <p class="review-outdated">Line changed or disappeared. Reattach before copying.</p>}
        <div class="review-item-actions"><button type="button" onClick={() => onEdit(draft.id)}>Edit</button>{draft.state === "outdated" && <button type="button" onClick={() => onReattach(draft.id)}>Reattach to line</button>}</div>
      </article>)}
      {outdated.length > 0 && <p class="review-hint">{outdated.length} outdated comment{outdated.length === 1 ? " is" : "s are"} excluded from export.</p>}
      {state.check.kind === "ready" && exportText.length > 0 && <div class="review-export"><label for="review-export-text">Copyable feedback text</label><textarea id="review-export-text" ref={textRef} readOnly value={exportText} rows={8} onFocus={(event) => event.currentTarget.select()} /><button type="button" onClick={() => textRef.current?.select()}>Select text</button></div>}
      {state.copy.kind === "error" && <p class="review-error" role="alert">{state.copy.message}</p>}
      {undoError !== null && <p class="review-error" role="alert">{undoError}</p>}
      {store.history.length > 0 && <section class="review-history"><h3>Copy history</h3>{store.history.map((entry) => <details class="review-history-item" key={entry.id}><summary>{new Date(entry.copiedAt).toLocaleString()} · {entry.comments.length} comments</summary><textarea readOnly value={entry.text} rows={6} onFocus={(event) => event.currentTarget.select()} /><button type="button" onClick={() => onCopyHistory(entry.text)} disabled={state.copy.kind === "copying"}>Copy again</button></details>)}</section>}
    </div>
    <div class="review-dialog-actions review-feedback-actions"><button type="button" onClick={onCheck} disabled={state.check.kind === "checking" || state.copy.kind === "copying" || store.drafts.length === 0}>Check lines</button><button type="button" onClick={onUndo} disabled={!canUndo}>Undo last copy</button><button class="review-primary" type="button" onClick={onCopy} disabled={state.check.kind !== "ready" || state.copy.kind === "copying" || exportText.length === 0}>Copy feedback</button></div>
  </dialog>;
}
