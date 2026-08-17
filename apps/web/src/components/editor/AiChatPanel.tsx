"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { cn } from "@/lib/utils/cn";
import { Sparkles, Send, X, Loader2, Undo2 } from "lucide-react";

interface AiEdit {
  filePath: string;
  oldText: string;
  newText: string;
  startIndex: number;
  line: number;
}

interface SkippedAiEdit {
  filePath: string;
  reason: string;
}

interface AiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  error?: boolean;
  activity?: string[];
  appliedEdits?: AiEdit[];
  skippedEdits?: SkippedAiEdit[];
  selectionLabel?: string;
  canUndo?: boolean;
  undoing?: boolean;
  undone?: boolean;
  undoError?: string;
}

interface AiSelection {
  fromLine: number;
  toLine: number;
  text: string;
}

interface ChatResult {
  reply: string;
  appliedEdits: AiEdit[];
  skippedEdits: SkippedAiEdit[];
}

interface ChatResponse {
  activity: string[];
  errorMessage?: string;
  result?: ChatResult;
}

type ChatEvent =
  | { type: "activity"; message: string; append?: boolean }
  | { type: "result" } & ChatResult
  | { type: "error"; message: string };

interface AiChatPanelProps {
  projectId: string;
  activeFile: { id: string; path: string } | null;
  getFileContent: () => string | undefined;
  pendingSelection: AiSelection | null;
  onClearSelection: () => void;
  onEditsApplied: (touchedPaths: string[]) => void;
}

function parseChatResult(value: unknown): ChatResult {
  const data = value as Partial<ChatResult>;
  return {
    reply: typeof data.reply === "string" ? data.reply : "",
    appliedEdits: Array.isArray(data.appliedEdits) ? data.appliedEdits : [],
    skippedEdits: Array.isArray(data.skippedEdits) ? data.skippedEdits : [],
  };
}

async function readNdjson(
  response: Response,
  onEvent: (event: ChatEvent) => void
) {
  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();
  let buffer = "";
  const readLine = (line: string) => {
    if (!line.trim()) return;
    try {
      onEvent(JSON.parse(line) as ChatEvent);
    } catch {
      // Ignore malformed diagnostics; the final result still determines success.
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    lines.forEach(readLine);
    if (done) break;
  }
  readLine(buffer);
}

async function readChatResponse(
  response: Response,
  onActivity: (activity: string[]) => void
): Promise<ChatResponse> {
  const activity: string[] = [];
  let result: ChatResult | undefined;
  let errorMessage: string | undefined;

  if (response.headers.get("content-type")?.includes("application/x-ndjson")) {
    await readNdjson(response, (streamEvent) => {
      if (streamEvent.type === "activity") {
        if (streamEvent.append && activity.length > 0) {
          activity[activity.length - 1] += streamEvent.message;
        } else {
          activity.push(streamEvent.message);
        }
        onActivity([...activity]);
      } else if (streamEvent.type === "result") {
        result = parseChatResult(streamEvent);
      } else if (streamEvent.type === "error") {
        errorMessage = streamEvent.message;
      }
    });
  } else {
    const data = await response.json().catch(() => ({}));
    if (response.ok) result = parseChatResult(data);
    else errorMessage = typeof data.error === "string" ? data.error : undefined;
  }

  return { activity, errorMessage, result };
}

function historyContent(message: AiMessage) {
  if (!message.appliedEdits?.length) return message.content;

  const editBlock = JSON.stringify(message.appliedEdits).slice(0, 6000);
  const metadata = `\n\n[Applied edits: ${editBlock}]`;
  if (metadata.length >= 8000) return metadata.slice(0, 8000);
  return `${message.content.slice(0, Math.max(0, 8000 - metadata.length))}${metadata}`;
}

export function AiChatPanel({
  projectId,
  activeFile,
  getFileContent,
  pendingSelection,
  onClearSelection,
  onEditsApplied,
}: AiChatPanelProps) {
  // ponytail: per-file threads are memory-only; lift them only if persistence is needed.
  const [threads, setThreads] = useState<Map<string, AiMessage[]>>(new Map());
  const [input, setInput] = useState("");
  const [sendingFileId, setSendingFileId] = useState<string | null>(null);
  const [activity, setActivity] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageIdRef = useRef(0);

  const sending = sendingFileId !== null;
  const thinking = activeFile !== null && sendingFileId === activeFile.id;
  const messages = activeFile ? threads.get(activeFile.id) ?? [] : [];
  const lastUndoableMessageId = messages.reduce<string | undefined>(
    (lastId, message) =>
      message.role === "assistant" &&
      message.appliedEdits?.length &&
      message.canUndo !== false &&
      !message.undone
        ? message.id
        : lastId,
    undefined
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, thinking, activity.length]);

  function nextMessageId() {
    messageIdRef.current += 1;
    return String(messageIdRef.current);
  }

  function appendMessage(fileId: string, message: AiMessage) {
    setThreads((previous) => {
      const next = new Map(previous);
      next.set(fileId, [...(next.get(fileId) ?? []), message]);
      return next;
    });
  }

  function updateMessage(
    fileId: string,
    messageId: string,
    update: Partial<AiMessage>
  ) {
    setThreads((previous) => {
      const next = new Map(previous);
      next.set(
        fileId,
        (next.get(fileId) ?? []).map((message) =>
          message.id === messageId ? { ...message, ...update } : message
        )
      );
      return next;
    });
  }

  function applyResult(
    fileId: string,
    result: ChatResult,
    completedActivity: string[],
    canUndo = true
  ) {
    appendMessage(fileId, {
      id: nextMessageId(),
      role: "assistant",
      content: result.reply,
      activity: completedActivity,
      appliedEdits: result.appliedEdits,
      skippedEdits: result.skippedEdits,
      canUndo,
    });

    const touchedPaths = [
      ...new Set(result.appliedEdits.map((edit) => edit.filePath)),
    ];
    if (touchedPaths.length > 0) onEditsApplied(touchedPaths);
  }

  async function handleUndo(fileId: string, message: AiMessage) {
    if (
      !activeFile ||
      !message.appliedEdits?.length ||
      message.undoing ||
      sending
    ) {
      return;
    }

    updateMessage(fileId, message.id, { undoing: true, undoError: undefined });
    setSendingFileId(fileId);
    setActivity([]);
    try {
      const fileContent = getFileContent();
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          filePath: activeFile.path,
          ...(fileContent !== undefined ? { fileContent } : {}),
          undoEdits: [...message.appliedEdits].reverse().map((edit) => ({
            filePath: edit.filePath,
            oldText: edit.newText,
            newText: edit.oldText,
            startIndex: edit.startIndex,
          })),
        }),
      });
      const chatResponse = await readChatResponse(response, setActivity);

      if (!response.ok || chatResponse.errorMessage || !chatResponse.result) {
        updateMessage(fileId, message.id, {
          undoing: false,
          undoError:
            chatResponse.errorMessage ?? "Undo failed. Please try again.",
        });
        appendMessage(fileId, {
          id: nextMessageId(),
          role: "assistant",
          content:
            chatResponse.errorMessage ?? "Undo failed. Please try again.",
          error: true,
          activity: chatResponse.activity,
        });
        return;
      }

      applyResult(fileId, chatResponse.result, chatResponse.activity, false);
      const fullyUndone =
        chatResponse.result.appliedEdits.length === message.appliedEdits.length;
      updateMessage(fileId, message.id, {
        undoing: false,
        undone: fullyUndone,
        undoError: fullyUndone
          ? undefined
          : "Undo was only partially applied. See details below.",
      });
    } catch {
      updateMessage(fileId, message.id, {
        undoing: false,
        undoError: "Undo failed. Please try again.",
      });
    } finally {
      setActivity([]);
      setSendingFileId(null);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || !activeFile || sending) return;

    const fileId = activeFile.id;
    const filePath = activeFile.path;
    const selection = pendingSelection;
    const userMessage: AiMessage = {
      id: nextMessageId(),
      role: "user",
      content: trimmed,
      selectionLabel: selection
        ? `Re: lines ${selection.fromLine}–${selection.toLine}`
        : undefined,
    };
    const history = [...(threads.get(fileId) ?? []), userMessage]
      .filter((message) => !message.error)
      .slice(-30)
      .map((message) => ({
        role: message.role,
        content: historyContent(message),
      }));

    appendMessage(fileId, userMessage);
    setInput("");
    if (selection) onClearSelection();
    setSendingFileId(fileId);
    setActivity([]);

    try {
      const fileContent = getFileContent();
      const response = await fetch("/api/ai/chat", {
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
      const chatResponse = await readChatResponse(response, setActivity);

      if (!response.ok || chatResponse.errorMessage || !chatResponse.result) {
        appendMessage(fileId, {
          id: nextMessageId(),
          role: "assistant",
          content:
            chatResponse.errorMessage ??
            "AI request failed. Please try again.",
          error: true,
          activity: chatResponse.activity,
        });
        return;
      }

      applyResult(fileId, chatResponse.result, chatResponse.activity);
    } catch {
      appendMessage(fileId, {
        id: nextMessageId(),
        role: "assistant",
        content: "Network error. Please try again.",
        error: true,
        activity,
      });
    } finally {
      setActivity([]);
      setSendingFileId(null);
    }
  }

  return (
    <div className="flex h-full flex-col bg-bg-secondary">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-accent" />
        <span className="min-w-0 flex-1 truncate text-xs text-text-muted">
          {activeFile ? activeFile.path : "No file open"}
        </span>
      </div>

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
              Ask about this document. I can edit it directly. Select lines in
              the editor to focus my attention.
            </p>
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={cn(
                "flex flex-col",
                message.role === "user" && "items-end"
              )}
            >
              <div
                className={cn(
                  "max-w-[85%] whitespace-pre-wrap rounded-lg px-2.5 py-1.5 text-xs leading-relaxed",
                  message.role === "user"
                    ? "bg-accent/15 text-text-primary"
                    : message.error
                      ? "border border-error/30 bg-error/10 text-error"
                      : "bg-bg-elevated text-text-secondary"
                )}
              >
                {message.selectionLabel && (
                  <p className="mb-1 text-[10px] font-semibold text-accent">
                    {message.selectionLabel}
                  </p>
                )}
                {message.content}
                {message.activity?.length ? (
                  <details className="mt-1.5 border-t border-border/60 pt-1 text-[10px] text-text-muted">
                    <summary className="cursor-pointer font-medium">
                      Activity ({message.activity.length})
                    </summary>
                    <ul
                      className="mt-1 space-y-0.5 pl-3"
                      aria-label="AI activity log"
                    >
                      {message.activity.map((item, index) => (
                        <li key={`${item}-${index}`}>{item}</li>
                      ))}
                    </ul>
                  </details>
                ) : null}
                {message.appliedEdits?.length ? (
                  <div className="mt-1.5 border-t border-border/60 pt-1 text-[10px] text-accent">
                    <p className="font-medium">
                      ✎ Applied {message.appliedEdits.length} edit
                      {message.appliedEdits.length === 1 ? "" : "s"}
                    </p>
                    <ul className="mt-0.5 space-y-0.5 text-text-muted">
                      {message.appliedEdits.map((edit, index) => (
                        <li key={`${edit.filePath}-${edit.line}-${index}`}>
                          {edit.filePath}:{edit.line}
                        </li>
                      ))}
                    </ul>
                    {message.id === lastUndoableMessageId && !message.undone ? (
                      <button
                        type="button"
                        onClick={() => handleUndo(activeFile.id, message)}
                        disabled={sending || message.undoing}
                        className="mt-1 inline-flex items-center gap-1 font-medium text-accent hover:text-text-primary disabled:opacity-50"
                      >
                        <Undo2 className="h-3 w-3" />
                        {message.undoing ? "Undoing…" : "Undo"}
                      </button>
                    ) : message.undone ? (
                      <p className="mt-1 text-text-muted">Undone</p>
                    ) : null}
                    {message.undoError && (
                      <p className="mt-1 text-error">{message.undoError}</p>
                    )}
                  </div>
                ) : null}
                {message.skippedEdits?.length ? (
                  <ul
                    className="mt-1.5 space-y-0.5 border-t border-error/30 pt-1 text-[10px] text-error"
                    aria-label="Edits not applied"
                  >
                    {message.skippedEdits.map((edit, index) => (
                      <li key={`${edit.filePath}-${index}`}>
                        Not applied: {edit.filePath}. {edit.reason}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
          ))
        )}

        {sending && (
          <div
            className="text-[11px] text-text-muted"
            role="status"
            aria-live="polite"
          >
            {thinking ? (
              <div className="rounded-md bg-bg-elevated px-2.5 py-1.5">
                <div className="flex items-center gap-1.5">
                  <Loader2 className="h-3 w-3 animate-spin" /> Working
                </div>
                <ul className="mt-1 space-y-0.5 pl-3">
                  {(activity.length ? activity : ["Starting request…"]).map(
                    (item, index) => (
                      <li key={`${item}-${index}`}>{item}</li>
                    )
                  )}
                </ul>
              </div>
            ) : (
              "Waiting on a reply for another file…"
            )}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

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
          onChange={(event) => setInput(event.target.value)}
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
