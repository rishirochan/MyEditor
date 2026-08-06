"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { cn } from "@/lib/utils/cn";
import { Sparkles, Send, X, Loader2 } from "lucide-react";

// ─── Types ──────────────────────────────────────────

interface AiMessage {
  role: "user" | "assistant";
  content: string;
  error?: boolean;
  /** Shown as a small footer when the assistant applied edits */
  editsApplied?: number;
  /** "Re: lines X–Y" label shown on user bubbles sent with a selection */
  selectionLabel?: string;
}

interface AiSelection {
  fromLine: number;
  toLine: number;
  text: string;
}

interface AiChatPanelProps {
  projectId: string;
  activeFile: { id: string; path: string } | null;
  /** Unsaved editor buffer, or undefined when the server should read disk */
  getFileContent: () => string | undefined;
  pendingSelection: AiSelection | null;
  onClearSelection: () => void;
  onEditsApplied: (touchedPaths: string[]) => void;
  onClose: () => void;
}

// ─── AiChatPanel ────────────────────────────────────

export function AiChatPanel({
  projectId,
  activeFile,
  getFileContent,
  pendingSelection,
  onClearSelection,
  onEditsApplied,
  onClose,
}: AiChatPanelProps) {
  // ponytail: per-file threads kept in this component's memory only, so they are
  // lost on reload and on closing the panel (it unmounts); lift to EditorLayout
  // or sessionStorage keyed by projectId if conversations should survive.
  const [threads, setThreads] = useState<Map<string, AiMessage[]>>(new Map());
  const [input, setInput] = useState("");
  // ponytail: one request at a time, tagged with the file it belongs to so a
  // mid-request file switch shows the reply/spinner on the right thread.
  const [sendingFileId, setSendingFileId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const sending = sendingFileId !== null;
  const thinking = activeFile !== null && sendingFileId === activeFile.id;
  const messages = activeFile ? threads.get(activeFile.id) ?? [] : [];

  // Auto-scroll to bottom on new messages / thinking indicator
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, thinking]);

  function appendMessage(fileId: string, message: AiMessage) {
    setThreads((prev) => {
      const next = new Map(prev);
      next.set(fileId, [...(next.get(fileId) ?? []), message]);
      return next;
    });
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || !activeFile || sending) return;

    const fileId = activeFile.id;
    const filePath = activeFile.path;
    const selection = pendingSelection;

    const userMessage: AiMessage = {
      role: "user",
      content: trimmed,
      selectionLabel: selection
        ? `Re: lines ${selection.fromLine}–${selection.toLine}`
        : undefined,
    };

    // Full history (error bubbles excluded), capped at the last 30 messages
    const history = [...(threads.get(fileId) ?? []), userMessage]
      .filter((m) => !m.error)
      .slice(-30)
      .map((m) => ({ role: m.role, content: m.content }));

    appendMessage(fileId, userMessage);
    setInput("");
    if (selection) onClearSelection();
    setSendingFileId(fileId);

    try {
      const fileContent = getFileContent();
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          filePath,
          ...(fileContent !== undefined ? { fileContent } : {}),
          messages: history,
          ...(selection ? { selection } : {}),
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        appendMessage(fileId, {
          role: "assistant",
          content:
            typeof data.error === "string" && data.error.length > 0
              ? data.error
              : "AI request failed. Please try again.",
          error: true,
        });
        return;
      }

      const appliedEdits: { filePath?: string }[] = Array.isArray(
        data.appliedEdits
      )
        ? data.appliedEdits
        : [];

      appendMessage(fileId, {
        role: "assistant",
        content: typeof data.reply === "string" ? data.reply : "",
        editsApplied: appliedEdits.length > 0 ? appliedEdits.length : undefined,
      });

      if (appliedEdits.length > 0) {
        const touchedPaths = [
          ...new Set(
            appliedEdits
              .map((edit) => edit.filePath)
              .filter((p): p is string => typeof p === "string")
          ),
        ];
        if (touchedPaths.length > 0) onEditsApplied(touchedPaths);
      }
    } catch {
      appendMessage(fileId, {
        role: "assistant",
        content: "Network error — please try again.",
        error: true,
      });
    } finally {
      setSendingFileId(null);
    }
  }

  return (
    <div className="flex h-full flex-col border-l border-border bg-bg-secondary">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Sparkles className="h-4 w-4 shrink-0 text-accent" />
        <span className="text-sm font-medium text-text-primary">
          AI Assistant
        </span>
        {activeFile && (
          <span className="min-w-0 flex-1 truncate text-xs text-text-muted">
            {activeFile.path}
          </span>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close AI assistant"
          className="ml-auto rounded-md p-1 text-text-muted transition-colors hover:bg-bg-elevated hover:text-text-primary"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Messages */}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2">
        {!activeFile ? (
          <div className="flex h-full items-center justify-center">
            <p className="px-4 text-center text-xs text-text-muted">
              No file open. Open a file to chat about it.
            </p>
          </div>
        ) : messages.length === 0 && !thinking ? (
          <div className="flex h-full items-center justify-center">
            <p className="px-4 text-center text-xs text-text-muted">
              Ask about this document — I can edit it directly. Select lines in
              the editor to focus my attention.
            </p>
          </div>
        ) : (
          messages.map((msg, index) => (
            <div
              key={index}
              className={cn(
                "flex flex-col",
                msg.role === "user" && "items-end"
              )}
            >
              <div
                className={cn(
                  "max-w-[85%] whitespace-pre-wrap rounded-lg px-2.5 py-1.5 text-xs leading-relaxed",
                  msg.role === "user"
                    ? "bg-accent/15 text-text-primary"
                    : msg.error
                      ? "border border-error/30 bg-error/10 text-error"
                      : "bg-bg-elevated text-text-secondary"
                )}
              >
                {msg.selectionLabel && (
                  <p className="mb-1 text-[10px] font-semibold text-accent">
                    {msg.selectionLabel}
                  </p>
                )}
                {msg.content}
                {msg.editsApplied !== undefined && (
                  <p className="mt-1.5 border-t border-border/60 pt-1 text-[10px] font-medium text-accent">
                    ✎ Applied {msg.editsApplied} edit
                    {msg.editsApplied === 1 ? "" : "s"}
                  </p>
                )}
              </div>
            </div>
          ))
        )}

        {sending && (
          <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
            <Loader2 className="h-3 w-3 animate-spin" />
            {thinking ? "Thinking…" : "Waiting on a reply for another file…"}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Selection chip */}
      {pendingSelection && (
        <div className="border-t border-border px-3 pt-2">
          <div className="flex items-start gap-2 rounded-md border border-accent/30 bg-accent/5 px-2 py-1.5">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold text-accent">
                Lines {pendingSelection.fromLine}–{pendingSelection.toLine}
              </p>
              <p className="truncate text-[11px] text-text-secondary">
                {pendingSelection.text.slice(0, 80)}
                {pendingSelection.text.length > 80 ? "…" : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={onClearSelection}
              aria-label="Clear selection"
              className="shrink-0 rounded p-0.5 text-text-muted transition-colors hover:text-text-primary"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className={cn(
          "flex items-center gap-2 px-3 py-2",
          !pendingSelection && "border-t border-border"
        )}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={8000}
          disabled={sending || !activeFile}
          placeholder={
            activeFile ? "Ask about this document..." : "Open a file to chat"
          }
          className="flex-1 rounded-md border border-border bg-bg-primary px-2.5 py-1.5 text-xs text-text-primary outline-none placeholder:text-text-muted focus:border-accent disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!input.trim() || sending || !activeFile}
          aria-label="Send message"
          className="rounded-md p-1.5 text-accent transition-colors hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Send className="h-3.5 w-3.5" />
        </button>
      </form>
    </div>
  );
}
