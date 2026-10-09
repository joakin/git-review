import { useRef } from "preact/hooks";
import {
  maxBodyLength,
  snapshotFeedback,
  isSelectionSubject,
  rangeSourceText,
  type CommentAnchor,
  type CommentSubject,
  type CommentStore,
} from "./comments.ts";
import { useVoiceComment, VoiceCommentFooter } from "./VoiceComment.tsx";
import type { FeedbackState } from "./feedback-transactions.ts";
import { useModal } from "./modal.ts";
import type { EditorState } from "./review-feedback.ts";
import { Chevron } from "./Icons.tsx";

function anchorLabel(anchor: CommentAnchor, subject: CommentSubject): string {
  if (subject.kind === "range")
    return subject.parts
      .map((part) => {
        const first = part.anchors[0];
        const last = part.anchors.at(-1);
        if (first === undefined || last === undefined) return "";
        return `${first.kind === "file" ? "Working tree" : `${first.layer} · ${first.side}`} · ${first.line === last.line ? `line ${first.line}` : `lines ${first.line}–${last.line}`}`;
      })
      .join(" / ");
  return anchor.kind === "file"
    ? `Working tree · line ${anchor.line}`
    : `${anchor.layer} · ${anchor.side} line ${anchor.line}`;
}

function SourceQuote({ anchor, subject }: { anchor: CommentAnchor; subject: CommentSubject }) {
  if (subject.kind === "range")
    return (
      <div class="review-range-source">
        {subject.parts.map((part, index) => {
          const first = part.anchors[0];
          const last = part.anchors.at(-1);
          if (first === undefined || last === undefined) return null;
          const source = rangeSourceText(part);
          return (
            <section key={index}>
              <p class="review-range-label">
                {first.kind === "file" ? "Working tree" : first.side === "old" ? "Old" : "New"} ·{" "}
                {first.line === last.line
                  ? `line ${first.line}`
                  : `lines ${first.line}–${last.line}`}
              </p>
              <pre class="review-source" aria-label="Source range with selected text highlighted">
                {source.slice(0, part.start)}
                <mark class="review-selected-text">{part.text}</mark>
                {source.slice(part.end)}
              </pre>
            </section>
          );
        })}
      </div>
    );
  return (
    <pre
      class="review-source"
      aria-label={
        subject.kind === "selection" ? "Source line with selected text highlighted" : "Source line"
      }
    >
      {subject.kind === "line" ? (
        anchor.sourceText
      ) : (
        <>
          {anchor.sourceText.slice(0, subject.start)}
          <mark class="review-selected-text">{subject.text}</mark>
          {anchor.sourceText.slice(subject.end)}
        </>
      )}
    </pre>
  );
}

export function CommentEditor({
  editor,
  onBody,
  onClose,
  onDelete,
}: {
  editor: EditorState;
  onBody: (body: string) => void;
  onClose: () => void;
  onDelete: () => void;
}) {
  const modal = useModal(onClose);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const voice = useVoiceComment(textareaRef, onBody);
  return (
    <dialog
      class="review-dialog comment-editor"
      ref={modal.ref}
      onCancel={modal.onCancel}
      aria-labelledby="comment-editor-title"
    >
      <div class="review-dialog-head">
        <div>
          <p class="eyebrow">
            {isSelectionSubject(editor.subject) ? "SELECTION FEEDBACK" : "LINE FEEDBACK"}
          </p>
          <h2 id="comment-editor-title">
            {editor.draftId === null ? "Add a comment" : "Edit comment"}
          </h2>
        </div>
        <button
          type="button"
          class="review-dialog-close"
          aria-label="Close comment editor"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <p class="review-anchor">
        <strong>{editor.anchor.path}</strong>
        <span>
          {anchorLabel(editor.anchor, editor.subject)}
          {isSelectionSubject(editor.subject) ? " · selection" : ""}
        </span>
      </p>
      <SourceQuote anchor={editor.anchor} subject={editor.subject} />
      <div class="review-field">
        <label for="comment-body">Your feedback</label>
        <div class="review-composer">
          <textarea
            id="comment-body"
            ref={textareaRef}
            autofocus
            value={editor.body}
            readOnly={voice.locked}
            maxLength={maxBodyLength}
            rows={6}
            placeholder="Add a question, note, or suggestion…"
            onInput={(event) => onBody(event.currentTarget.value)}
          />
          <VoiceCommentFooter voice={voice} />
        </div>
      </div>
      <div class="review-dialog-actions">
        {editor.draftId !== null && (
          <button class="review-danger" type="button" onClick={onDelete}>
            Delete
          </button>
        )}
        <button class="review-primary" type="button" onClick={onClose}>
          Save comment
        </button>
      </div>
      <p class="review-hint">Closing saves non-empty text on this device.</p>
    </dialog>
  );
}

export function FeedbackDialog({
  store,
  projectPath,
  state,
  onClose,
  onCheck,
  onCopy,
  onEdit,
  onReattach,
  onUndo,
  canUndo,
  onCopyHistory,
}: {
  store: CommentStore;
  projectPath: string;
  state: FeedbackState;
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
  const exportText =
    state.check.kind === "ready"
      ? snapshotFeedback(projectPath, store, state.check.checked).text
      : "";
  return (
    <dialog
      class="review-dialog feedback-dialog"
      ref={modal.ref}
      onCancel={modal.onCancel}
      aria-labelledby="feedback-title"
    >
      <div class="review-dialog-head">
        <div>
          <p class="eyebrow">REVIEW DRAFT</p>
          <h2 id="feedback-title">
            Feedback <span class="review-count">{store.drafts.length}</span>
          </h2>
        </div>
        <button
          type="button"
          class="review-dialog-close"
          aria-label="Close feedback"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <div class="review-dialog-content">
        {state.check.kind === "checking" && (
          <p class="review-status" role="status">
            Checking source lines…
          </p>
        )}
        {state.copy.kind === "copying" && state.check.kind !== "checking" && (
          <p class="review-status" role="status">
            Copying feedback…
          </p>
        )}
        {store.drafts.length === 0 && (
          <p class="review-empty">
            Tap a code line in Files, a Search result, or a working-copy diff, then choose Comment.
          </p>
        )}
        {store.drafts.map((draft) => (
          <article
            class={`review-item${draft.state === "outdated" ? " review-item-outdated" : ""}`}
            key={draft.id}
          >
            <div class="review-item-top">
              <strong>{draft.anchor.path}</strong>
              <span>
                {anchorLabel(draft.anchor, draft.subject)}
                {isSelectionSubject(draft.subject) ? " · selection" : ""}
              </span>
            </div>
            <SourceQuote anchor={draft.anchor} subject={draft.subject} />
            <p>{draft.body}</p>
            {draft.state === "outdated" && (
              <p class="review-outdated">Line changed or disappeared. Reattach before copying.</p>
            )}
            <div class="review-item-actions">
              <button type="button" onClick={() => onEdit(draft.id)}>
                Edit
              </button>
              {draft.state === "outdated" && (
                <button type="button" onClick={() => onReattach(draft.id)}>
                  {isSelectionSubject(draft.subject) ? "Reattach selection" : "Reattach to line"}
                </button>
              )}
            </div>
          </article>
        ))}
        {outdated.length > 0 && (
          <p class="review-hint">
            {outdated.length} outdated comment{outdated.length === 1 ? " is" : "s are"} excluded
            from export.
          </p>
        )}
        {state.check.kind === "ready" && exportText.length > 0 && (
          <div class="review-export">
            <label for="review-export-text">Copyable feedback text</label>
            <textarea
              id="review-export-text"
              ref={textRef}
              readOnly
              value={exportText}
              rows={8}
              onFocus={(event) => event.currentTarget.select()}
            />
            <button type="button" onClick={() => textRef.current?.select()}>
              Select text
            </button>
          </div>
        )}
        {store.history.length > 0 && (
          <section class="review-history">
            <h3>Copy history</h3>
            {store.history.map((entry) => (
              <details class="review-history-item" key={entry.id}>
                <summary>
                  <Chevron />
                  <span>
                    {new Date(entry.copiedAt).toLocaleString()} · {entry.comments.length} comments
                  </span>
                </summary>
                <textarea
                  readOnly
                  value={entry.text}
                  rows={6}
                  onFocus={(event) => event.currentTarget.select()}
                />
                <button
                  type="button"
                  onClick={() => onCopyHistory(entry.text)}
                  disabled={state.copy.kind === "copying"}
                >
                  Copy again
                </button>
              </details>
            ))}
          </section>
        )}
      </div>
      <div class="review-dialog-actions review-feedback-actions">
        <button
          type="button"
          onClick={onCheck}
          disabled={
            state.check.kind === "checking" ||
            state.copy.kind === "copying" ||
            store.drafts.length === 0
          }
        >
          Check lines
        </button>
        <button type="button" onClick={onUndo} disabled={!canUndo}>
          Undo last copy
        </button>
        <button
          class="review-primary"
          type="button"
          onClick={onCopy}
          disabled={
            state.check.kind !== "ready" || state.copy.kind === "copying" || exportText.length === 0
          }
        >
          Copy feedback
        </button>
      </div>
    </dialog>
  );
}
