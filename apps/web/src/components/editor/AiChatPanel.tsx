"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { cn } from "@/lib/utils/cn";
import { Sparkles, Send, X, Loader2, Undo2, Trash2 } from "lucide-react";

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

/* Fenced blocks, backtick spans and bare LaTeX control sequences read as code.
   ponytail: no markdown parser, and `$…$` math is left alone so prices don't
   get monospaced. Add a parser only if messages start carrying real markdown. */
const CODE_PARTS = /(```[\s\S]*?```|`[^`\n]+`|\\[a-zA-Z@]+\*?)/g;

export function MessageText({ text }: { text: string }) {
  return (
    <>
      {text.split(CODE_PARTS).map((part, index) => {
        if (part.startsWith("```")) {
          return (
            <code
              key={index}
              className="my-1 block overflow-x-auto rounded-md bg-bg-inset px-2 py-1.5 font-mono text-[11px] leading-[1.7] whitespace-pre text-text-primary"
            >
              {part.replace(/^```[^\n]*\n?/, "").replace(/```$/, "")}
            </code>
          );
        }
        if (part.startsWith("`") && part.length > 1) {
          return (
            <code
              key={index}
              className="rounded bg-bg-inset px-1 py-0.5 font-mono text-[11px] text-text-primary"
            >
              {part.slice(1, -1)}
            </code>
          );
        }
        if (part.startsWith("\\") && part.length > 1) {
          return (
            <code
              key={index}
              className="rounded bg-bg-inset px-1 py-0.5 font-mono text-[11px] text-text-primary"
            >
              {part}
            </code>
          );
        }
        return <span key={index}>{part}</span>;
      })}
    </>
  );
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

function loadThreads(storageKey: string): Map<string, AiMessage[]> {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return new Map();
    const stored: Record<string, AiMessage[]> = JSON.parse(raw);
    return new Map(
      Object.entries(stored).map(([fileId, messages]) => [
        fileId,
        // A reload cancels any in-flight undo, so never restore it as pending.
        messages.map((message) => ({ ...message, undoing: false })),
      ])
    );
  } catch {
    return new Map();
  }
}

export function AiChatPanel({
  projectId,
  activeFile,
  getFileContent,
  pendingSelection,
  onClearSelection,
  onEditsApplied,
}: AiChatPanelProps) {
  // ponytail: per-file threads live in localStorage; move to the DB if they need to
  // follow the user across browsers.
  const [threads, setThreads] = useState<Map<string, AiMessage[]>>(new Map());
  const [input, setInput] = useState("");
  const [sendingFileId, setSendingFileId] = useState<string | null>(null);
  const [activity, setActivity] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageIdRef = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const loadedKeyRef = useRef<string | null>(null);
  const storageKey = `ai-chat:${projectId}`;

  // Load once per project (after mount, so SSR markup still matches), then persist
  // every change so a reload or hot update keeps the conversation.
  useEffect(() => {
    if (loadedKeyRef.current !== storageKey) {
      loadedKeyRef.current = storageKey;
      const loaded = loadThreads(storageKey);
      messageIdRef.current = Math.max(
        0,
        ...[...loaded.values()].flatMap((messages) =>
          messages.map((message) => Number(message.id) || 0)
        )
      );
      setThreads(loaded);
      return;
    }
    try {
      window.localStorage.setItem(
        storageKey,
        JSON.stringify(Object.fromEntries(threads))
      );
    } catch {
      // ponytail: out of quota — drop persistence rather than break the chat.
    }
  }, [threads, storageKey]);

  // Grow the composer to fit its content instead of scrolling.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

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
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-accent" />
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-text-muted">
          {activeFile ? activeFile.path : "No file open"}
        </span>
        <button
          type="button"
          onClick={() => {
            if (!activeFile || messages.length === 0) return;
            if (!window.confirm("Clear this chat?")) return;
            // /api/ai/chat is stateless and rebuilds context from client messages,
            // so dropping the thread resets the assistant memory.
            setThreads((previous) => {
              const next = new Map(previous);
              next.delete(activeFile.id);
              return next;
            });
            setActivity([]);
          }}
          disabled={!activeFile || sending || messages.length === 0}
          aria-label="Clear chat"
          title="Clear chat"
          className="rounded-md p-1 text-text-muted transition-colors duration-150 ease-out hover:bg-bg-elevated hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
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
                  "whitespace-pre-wrap rounded-lg px-2.5 py-1.5 text-xs leading-relaxed",
                  message.role === "user"
                    ? "max-w-[85%] bg-accent-subtle text-text-primary"
                    : message.error
                      ? "max-w-[95%] border border-error bg-error-subtle text-error"
                      : "max-w-[95%] bg-bg-elevated text-text-secondary"
                )}
              >
                {message.selectionLabel && (
                  <p className="mb-1 font-mono text-[10px] font-medium text-accent">
                    {message.selectionLabel}
                  </p>
                )}
                <MessageText text={message.content} />
                {message.activity?.length ? (
                  <details className="mt-1.5 border-t border-border-subtle pt-1 text-[10px] text-text-muted">
                    <summary className="cursor-pointer font-medium transition-colors duration-150 ease-out hover:text-text-secondary">
                      Activity ({message.activity.length})
                    </summary>
                    <ul
                      className="mt-1 space-y-0.5 pl-3 font-mono"
                      aria-label="AI activity log"
                    >
                      {message.activity.map((item, index) => (
                        <li key={`${item}-${index}`}>{item}</li>
                      ))}
                    </ul>
                  </details>
                ) : null}
                {message.appliedEdits?.length ? (
                  <div className="mt-1.5 border-t border-border-subtle pt-1 text-[10px]">
                    <p className="font-medium text-accent">
                      Applied {message.appliedEdits.length} edit
                      {message.appliedEdits.length === 1 ? "" : "s"}
                    </p>
                    <ul className="mt-0.5 space-y-0.5 font-mono text-text-muted">
                      {message.appliedEdits.map((edit, index) => (
                        <li key={`${edit.filePath}-${edit.line}-${index}`} data-numeric>
                          {edit.filePath}:{edit.line}
                        </li>
                      ))}
                    </ul>
                    {message.id === lastUndoableMessageId && !message.undone ? (
                      <button
                        type="button"
                        onClick={() => handleUndo(activeFile.id, message)}
                        disabled={sending || message.undoing}
                        className="mt-1 inline-flex items-center gap-1 font-medium text-accent transition-colors duration-150 ease-out hover:text-accent-hover disabled:opacity-50"
                      >
                        <Undo2 className="h-3 w-3" />
                        {message.undoing ? "Undoing..." : "Undo"}
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
                    className="mt-1.5 space-y-0.5 border-t border-border-subtle pt-1 text-[10px] text-error"
                    aria-label="Edits not applied"
                  >
                    {message.skippedEdits.map((edit, index) => (
                      <li key={`${edit.filePath}-${index}`}>
                        Not applied: <span className="font-mono">{edit.filePath}</span>. {edit.reason}
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
              <div className="animate-fade-in rounded-lg bg-bg-elevated px-2.5 py-1.5">
                <div className="flex items-center gap-1.5 font-medium text-text-secondary">
                  <Loader2 className="h-3 w-3 animate-spin text-accent" />
                  Working
                </div>
                <ul className="mt-1 space-y-0.5 pl-3 font-mono">
                  {(activity.length ? activity : ["Starting request..."]).map(
                    (item, index, all) => (
                      <li
                        key={`${item}-${index}`}
                        className={cn(
                          index === all.length - 1 && "animate-pulse-soft text-text-secondary"
                        )}
                      >
                        {item}
                      </li>
                    )
                  )}
                </ul>
              </div>
            ) : (
              "Waiting on a reply for another file"
            )}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {pendingSelection && (
        <div className="shrink-0 border-t border-border px-3 pt-2">
          <div className="flex items-start gap-2 rounded-md border border-accent-muted bg-accent-subtle px-2 py-1.5">
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[10px] font-medium text-accent" data-numeric>
                Lines {pendingSelection.fromLine}–{pendingSelection.toLine}
              </p>
              <p className="truncate font-mono text-[11px] text-text-secondary">
                {pendingSelection.text.slice(0, 80)}
                {pendingSelection.text.length > 80 ? "…" : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={onClearSelection}
              aria-label="Clear selection"
              className="shrink-0 rounded p-0.5 text-text-muted transition-colors duration-150 ease-out hover:text-text-primary"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className={cn(
          "flex shrink-0 items-end gap-2 px-3 py-2",
          !pendingSelection && "border-t border-border"
        )}
      >
        <textarea
          ref={inputRef}
          rows={1}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          maxLength={8000}
          disabled={sending || !activeFile}
          placeholder={
            activeFile ? "Ask about this document..." : "Open a file to chat"
          }
          className="input flex-1 resize-none overflow-hidden px-2.5 py-1.5 text-xs"
        />
        <button
          type="submit"
          disabled={!input.trim() || sending || !activeFile}
          aria-label="Send message"
          title="Send (Enter)"
          className="btn btn-primary shrink-0 rounded-md p-1.5"
        >
          {sending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Send className="h-3.5 w-3.5" />
          )}
        </button>
      </form>
    </div>
  );
}
