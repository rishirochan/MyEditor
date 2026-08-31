"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import Image from "next/image";
import { cn } from "@/lib/utils/cn";
import {
  AI_IMAGE_MEDIA_TYPES,
  MAX_AI_IMAGE_BYTES,
  MAX_AI_IMAGE_TOTAL_BYTES,
  MAX_AI_IMAGES,
  isAiImageMediaType,
  isValidAiImage,
  type AiImageInput,
} from "@/lib/ai/imageInput";
import { parseStoredContextIds } from "./aiContextStorage";
import {
  ImagePlus,
  Loader2,
  Send,
  Sparkles,
  Trash2,
  Undo2,
  X,
} from "lucide-react";

const MAX_CONTEXT_FILES = 2;

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
  contextLabel?: string;
  canUndo?: boolean;
  undoing?: boolean;
  undone?: boolean;
  undoError?: string;
  screenshotCount?: number;
}

interface PendingScreenshot {
  id: string;
  name: string;
  size: number;
  image: AiImageInput;
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

interface ContextFile {
  id: string;
  path: string;
}

interface AiChatPanelProps {
  projectId: string;
  files: ContextFile[];
  anchorFile: ContextFile | null;
  getFileContent: (fileId: string) => string | undefined;
  ensureFileContent: (fileId: string) => void;
  pendingSelection: AiSelection | null;
  pendingPrompt: string | null;
  configured: boolean | null;
  onClearSelection: () => void;
  onClearPrompt: () => void;
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

function parentDir(filePath: string): string {
  const index = filePath.lastIndexOf("/");
  return index === -1 ? "" : filePath.slice(0, index);
}

function fileName(filePath: string): string {
  return filePath.split("/").pop() ?? filePath;
}

function readScreenshot(file: File): Promise<PendingScreenshot> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Screenshot could not be read."));
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      const data = dataUrl.slice(dataUrl.indexOf(",") + 1);
      if (!isAiImageMediaType(file.type)) {
        reject(new Error("Use a PNG, JPEG, or WebP screenshot."));
        return;
      }
      const image = { mediaType: file.type, data };
      if (!isValidAiImage(image)) {
        reject(new Error(`${file.name} is not a valid image.`));
        return;
      }
      resolve({ id: crypto.randomUUID(), name: file.name, size: file.size, image });
    };
    reader.readAsDataURL(file);
  });
}

function screenshotError(
  files: File[],
  current: PendingScreenshot[]
): string | null {
  if (files.some((file) => !isAiImageMediaType(file.type))) {
    return "Use PNG, JPEG, or WebP screenshots.";
  }
  if (files.some((file) => file.size > MAX_AI_IMAGE_BYTES)) {
    return "Each screenshot must be 5 MB or smaller.";
  }
  if (current.length + files.length > MAX_AI_IMAGES) {
    return `Attach up to ${MAX_AI_IMAGES} screenshots.`;
  }
  const totalBytes = [...current, ...files].reduce(
    (total, item) => total + item.size,
    0
  );
  return totalBytes > MAX_AI_IMAGE_TOTAL_BYTES
    ? "Screenshots must total 10 MB or less."
    : null;
}

function EditDiff({ edit }: { edit: AiEdit }) {
  return (
    <details
      open
      className="overflow-hidden rounded-md border border-border-subtle bg-bg-inset"
    >
      <summary
        className="cursor-pointer border-b border-border-subtle px-2 py-1 pr-10 font-mono text-[10px] text-text-muted hover:text-text-secondary"
        data-numeric
      >
        {edit.filePath}:{edit.line}
      </summary>
      <div
        className="max-h-56 overflow-auto font-mono text-[10px] leading-4"
        aria-label={`Changes to ${edit.filePath} at line ${edit.line}`}
      >
        {edit.oldText.split("\n").map((line, index) => (
          <div
            key={`old-${index}`}
            className="grid min-w-max grid-cols-[3ch_2ch_1fr] bg-error-subtle text-error"
          >
            <span className="select-none text-right opacity-60" data-numeric>
              {edit.line + index}
            </span>
            <span className="select-none text-center">−</span>
            <span className="pr-2 whitespace-pre">{line || " "}</span>
          </div>
        ))}
        {(edit.newText ? edit.newText.split("\n") : []).map((line, index) => (
          <div
            key={`new-${index}`}
            className="grid min-w-max grid-cols-[3ch_2ch_1fr] bg-success-subtle text-success"
          >
            <span className="select-none text-right opacity-60" data-numeric>
              {edit.line + index}
            </span>
            <span className="select-none text-center">+</span>
            <span className="pr-2 whitespace-pre">{line || " "}</span>
          </div>
        ))}
      </div>
    </details>
  );
}

function sanitizeMessages(messages: AiMessage[]): AiMessage[] {
  return messages.map((message) => ({ ...message, undoing: false }));
}

function loadMessages(projectId: string): AiMessage[] {
  try {
    const v2 = window.localStorage.getItem(`ai-chat-v2:${projectId}`);
    if (v2) {
      const parsed: unknown = JSON.parse(v2);
      if (Array.isArray(parsed)) return sanitizeMessages(parsed as AiMessage[]);
    }

    const v1 = window.localStorage.getItem(`ai-chat:${projectId}`);
    if (!v1) return [];
    const stored: Record<string, AiMessage[]> = JSON.parse(v1);
    const longest = Object.values(stored).reduce<AiMessage[]>(
      (best, thread) => (thread.length > best.length ? thread : best),
      []
    );
    return sanitizeMessages(longest);
  } catch {
    return [];
  }
}

export function AiChatPanel({
  projectId,
  files,
  anchorFile,
  getFileContent,
  ensureFileContent,
  pendingSelection,
  pendingPrompt,
  configured,
  onClearSelection,
  onClearPrompt,
  onEditsApplied,
}: AiChatPanelProps) {
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [activity, setActivity] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [manualContext, setManualContext] = useState(false);
  const [screenshots, setScreenshots] = useState<PendingScreenshot[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [isDraggingScreenshot, setIsDraggingScreenshot] = useState(false);
  const [loadedContextProjectId, setLoadedContextProjectId] = useState<
    string | null
  >(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageIdRef = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const screenshotInputRef = useRef<HTMLInputElement>(null);
  const loadedKeyRef = useRef<string | null>(null);
  const storageKey = `ai-chat-v2:${projectId}`;
  const contextStorageKey = `ai-context:${projectId}`;
  const contextLoaded = loadedContextProjectId === projectId;

  useEffect(() => {
    if (loadedKeyRef.current !== storageKey) {
      loadedKeyRef.current = storageKey;
      const loaded = loadMessages(projectId);
      messageIdRef.current = Math.max(
        0,
        ...loaded.map((message) => Number(message.id) || 0)
      );
      setMessages(loaded);
      return;
    }
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(messages));
    } catch {
      // ponytail: out of quota — drop persistence rather than break the chat.
    }
  }, [messages, projectId, storageKey]);

  useEffect(() => {
    setScreenshots([]);
    setAttachmentError(null);
  }, [projectId]);

  useEffect(() => {
    if (contextLoaded) return;
    let storedIds: string[] | null = null;
    try {
      storedIds = parseStoredContextIds(
        window.localStorage.getItem(contextStorageKey),
        new Set(files.map((file) => file.id))
      );
    } catch {
      // Browser storage is optional.
    }
    if (storedIds) {
      setSelectedIds(storedIds);
      setManualContext(true);
    } else {
      setManualContext(false);
    }
    setLoadedContextProjectId(projectId);
  }, [contextLoaded, contextStorageKey, files, projectId]);

  useEffect(() => {
    if (!contextLoaded) return;
    try {
      window.localStorage.setItem(
        contextStorageKey,
        JSON.stringify(selectedIds)
      );
    } catch {
      // Browser storage is optional.
    }
  }, [contextLoaded, contextStorageKey, selectedIds]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(el.scrollHeight, 36)}px`;
  }, [input]);

  useEffect(() => {
    if (!pendingPrompt) return;
    setInput(pendingPrompt);
    onClearPrompt();
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(
        pendingPrompt.length,
        pendingPrompt.length
      );
    });
  }, [onClearPrompt, pendingPrompt]);

  useEffect(() => {
    if (!contextLoaded) return;
    if (manualContext) {
      setSelectedIds((previous) => {
        const next = previous.filter((id) =>
          files.some((file) => file.id === id)
        );
        return next.length === previous.length ? previous : next;
      });
      return;
    }
    const next = anchorFile ? [anchorFile.id] : [];
    setSelectedIds((previous) =>
      previous.length === next.length &&
      previous.every((id, index) => id === next[index])
        ? previous
        : next
    );
  }, [anchorFile, contextLoaded, files, manualContext]);

  useEffect(() => {
    if (!pendingSelection || !anchorFile) return;
    const folder = parentDir(anchorFile.path);
    setManualContext(true);
    setSelectedIds((previous) => {
      const sameFolder = previous.filter((id) => {
        const file = files.find((entry) => entry.id === id);
        return file ? parentDir(file.path) === folder : false;
      });
      const next = sameFolder.includes(anchorFile.id)
        ? sameFolder
        : [anchorFile.id, ...sameFolder].slice(0, MAX_CONTEXT_FILES);
      return next.length === previous.length &&
        next.every((id, index) => id === previous[index])
        ? previous
        : next;
    });
  }, [anchorFile, files, pendingSelection]);

  const folderPath = parentDir(
    files.find((file) => selectedIds.includes(file.id))?.path ??
      anchorFile?.path ??
      ""
  );
  const folderFiles = files
    .filter((file) => parentDir(file.path) === folderPath)
    .sort((left, right) => left.path.localeCompare(right.path));
  const selectedFiles = folderFiles.filter((file) =>
    selectedIds.includes(file.id)
  );
  const hasContext = selectedFiles.length > 0;
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
    for (const id of selectedIds) {
      if (getFileContent(id) === undefined) ensureFileContent(id);
    }
  }, [ensureFileContent, getFileContent, selectedIds]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, sending, activity.length]);

  function nextMessageId() {
    messageIdRef.current += 1;
    return String(messageIdRef.current);
  }

  function filesPayload(targetFiles: ContextFile[]) {
    return targetFiles.map((file) => {
      const content = getFileContent(file.id);
      return content === undefined
        ? { path: file.path }
        : { path: file.path, content };
    });
  }

  function toggleFile(fileId: string) {
    setManualContext(true);
    setSelectedIds((previous) => {
      if (previous.includes(fileId)) {
        return previous.filter((id) => id !== fileId);
      }
      if (previous.length >= MAX_CONTEXT_FILES) return previous;
      return [...previous, fileId];
    });
  }

  async function addScreenshots(files: FileList | File[]) {
    const nextFiles = Array.from(files);
    const validationError = screenshotError(nextFiles, screenshots);
    if (validationError) {
      setAttachmentError(validationError);
      return;
    }

    try {
      const added = await Promise.all(nextFiles.map(readScreenshot));
      setScreenshots((previous) => [...previous, ...added]);
      setAttachmentError(null);
    } catch (error) {
      setAttachmentError(
        error instanceof Error ? error.message : "Screenshot could not be read."
      );
    }
  }

  function applyResult(
    result: ChatResult,
    completedActivity: string[],
    canUndo = true
  ) {
    setMessages((previous) => [
      ...previous,
      {
        id: nextMessageId(),
        role: "assistant",
        content: result.reply,
        activity: completedActivity,
        appliedEdits: result.appliedEdits,
        skippedEdits: result.skippedEdits,
        canUndo,
      },
    ]);

    const touchedPaths = [
      ...new Set(result.appliedEdits.map((edit) => edit.filePath)),
    ];
    if (touchedPaths.length > 0) onEditsApplied(touchedPaths);
  }

  async function handleUndo(message: AiMessage) {
    if (!message.appliedEdits?.length || message.undoing || sending) return;

    const undoFiles = [
      ...new Map(
        message.appliedEdits.map((edit) => {
          const file = files.find((entry) => entry.path === edit.filePath);
          return [edit.filePath, file] as const;
        })
      ).values(),
    ].filter((file): file is ContextFile => Boolean(file));

    if (undoFiles.length === 0) return;

    setMessages((previous) =>
      previous.map((entry) =>
        entry.id === message.id
          ? { ...entry, undoing: true, undoError: undefined }
          : entry
      )
    );
    setSending(true);
    setActivity([]);
    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          files: filesPayload(undoFiles),
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
        setMessages((previous) => [
          ...previous.map((entry) =>
            entry.id === message.id
              ? {
                  ...entry,
                  undoing: false,
                  undoError:
                    chatResponse.errorMessage ??
                    "Undo failed. Please try again.",
                }
              : entry
          ),
          {
            id: nextMessageId(),
            role: "assistant",
            content:
              chatResponse.errorMessage ?? "Undo failed. Please try again.",
            error: true,
            activity: chatResponse.activity,
          },
        ]);
        return;
      }

      applyResult(chatResponse.result, chatResponse.activity, false);
      const fullyUndone =
        chatResponse.result.appliedEdits.length === message.appliedEdits.length;
      setMessages((previous) =>
        previous.map((entry) =>
          entry.id === message.id
            ? {
                ...entry,
                undoing: false,
                undone: fullyUndone,
                undoError: fullyUndone
                  ? undefined
                  : "Undo was only partially applied. See details below.",
              }
            : entry
        )
      );
    } catch {
      setMessages((previous) =>
        previous.map((entry) =>
          entry.id === message.id
            ? {
                ...entry,
                undoing: false,
                undoError: "Undo failed. Please try again.",
              }
            : entry
        )
      );
    } finally {
      setActivity([]);
      setSending(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || !hasContext || sending) return;

    const selection = pendingSelection;
    const contextLabel = selectedFiles.map((file) => file.path).join(", ");
    const userMessage: AiMessage = {
      id: nextMessageId(),
      role: "user",
      content: trimmed,
      contextLabel,
      selectionLabel: selection
        ? `Re: lines ${selection.fromLine}–${selection.toLine}`
        : undefined,
      screenshotCount: screenshots.length || undefined,
    };
    const history = [...messages, userMessage]
      .filter((message) => !message.error)
      .slice(-30)
      .map((message) => ({
        role: message.role,
        content: historyContent(message),
      }));

    setMessages((previous) => [...previous, userMessage]);
    setInput("");
    setScreenshots([]);
    setAttachmentError(null);
    if (selection) onClearSelection();
    setSending(true);
    setActivity([]);

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          files: filesPayload(selectedFiles),
          messages: history,
          ...(screenshots.length
            ? { images: screenshots.map((screenshot) => screenshot.image) }
            : {}),
          ...(selection ? { selection } : {}),
        }),
      });
      const chatResponse = await readChatResponse(response, setActivity);

      if (!response.ok || chatResponse.errorMessage || !chatResponse.result) {
        setMessages((previous) => [
          ...previous,
          {
            id: nextMessageId(),
            role: "assistant",
            content:
              chatResponse.errorMessage ??
              "AI request failed. Please try again.",
            error: true,
            activity: chatResponse.activity,
          },
        ]);
        return;
      }

      applyResult(chatResponse.result, chatResponse.activity);
    } catch {
      setMessages((previous) => [
        ...previous,
        {
          id: nextMessageId(),
          role: "assistant",
          content: "Network error. Please try again.",
          error: true,
          activity,
        },
      ]);
    } finally {
      setActivity([]);
      setSending(false);
    }
  }

  const folderLabel = folderPath ? `${folderPath}/` : "project root";

  if (configured === false) {
    return (
      <div className="flex h-full items-center justify-center bg-bg-secondary">
        <Link
          href="/dashboard/settings"
          className="inline-flex animate-pulse-soft items-center gap-2 rounded-md px-3 py-2 text-xs font-medium text-error"
        >
          <span aria-hidden className="h-2.5 w-2.5 bg-error" />
          Configure
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-bg-secondary">
      <div className="shrink-0 border-b border-border">
        <div className="flex h-9 items-center gap-2 px-3">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-accent" />
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-text-muted">
            {folderLabel}
          </span>
          <span className="shrink-0 font-mono text-[10px] text-text-muted" data-numeric>
            {selectedFiles.length}/{MAX_CONTEXT_FILES}
          </span>
          <button
            type="button"
            onClick={() => {
              if (messages.length === 0) return;
              if (!window.confirm("Clear this chat?")) return;
              setMessages([]);
              setActivity([]);
            }}
            disabled={sending || messages.length === 0}
            aria-label="Clear chat"
            title="Clear chat"
            className="rounded-md p-1 text-text-muted transition-colors duration-150 ease-out hover:bg-bg-elevated hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex gap-1 overflow-x-auto px-3 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {folderFiles.length === 0 ? (
            <p className="py-0.5 text-[11px] text-text-muted">
              No .tex files in this folder.
            </p>
          ) : (
            folderFiles.map((file) => {
              const selected = selectedIds.includes(file.id);
              const atLimit =
                !selected && selectedFiles.length >= MAX_CONTEXT_FILES;
              return (
                <button
                  key={file.id}
                  type="button"
                  aria-pressed={selected}
                  disabled={atLimit}
                  title={
                    atLimit
                      ? `Deselect a file first (${MAX_CONTEXT_FILES} max)`
                      : file.path
                  }
                  onClick={() => toggleFile(file.id)}
                  className={cn(
                    "shrink-0 rounded-md border px-2 py-0.5 font-mono text-[11px]",
                    "transition-colors duration-150 ease-out",
                    selected
                      ? "border-accent-muted bg-accent-subtle text-accent"
                      : "border-border bg-bg-inset text-text-secondary hover:border-border-strong hover:text-text-primary",
                    atLimit && "cursor-not-allowed opacity-40"
                  )}
                >
                  {fileName(file.path)}
                </button>
              );
            })
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2">
        {!hasContext ? (
          <div className="flex h-full items-center justify-center">
            <p className="px-4 text-center text-xs text-text-muted">
              Select up to two .tex files for context.
            </p>
          </div>
        ) : messages.length === 0 && !sending ? (
          <div className="flex h-full items-center justify-center">
            <p className="px-4 text-center text-xs text-text-muted">
              Ask about the selected files. I can edit them directly.
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
                {message.contextLabel && (
                  <p className="mb-1 font-mono text-[10px] text-text-muted">
                    {message.contextLabel}
                  </p>
                )}
                {message.selectionLabel && (
                  <p className="mb-1 font-mono text-[10px] font-medium text-accent">
                    {message.selectionLabel}
                  </p>
                )}
                {message.screenshotCount ? (
                  <p className="mb-1 text-[10px] text-text-muted">
                    {message.screenshotCount} screenshot
                    {message.screenshotCount === 1 ? "" : "s"} attached
                  </p>
                ) : null}
                <MessageText text={message.content} />
                {message.appliedEdits?.length ? (
                  <div className="relative mt-1.5 space-y-1.5 border-t border-border-subtle pt-1.5 text-[10px]">
                    {message.appliedEdits.map((edit, index) => (
                      <EditDiff
                        key={`${edit.filePath}-${edit.line}-${index}`}
                        edit={edit}
                      />
                    ))}
                    {message.id === lastUndoableMessageId && !message.undone ? (
                      <button
                        type="button"
                        onClick={() => handleUndo(message)}
                        disabled={sending || message.undoing}
                        aria-label={message.undoing ? "Undoing edit" : "Undo edit"}
                        title={message.undoing ? "Undoing edit" : "Undo edit"}
                        className="btn btn-ghost absolute top-2 right-1 h-6 w-6 p-0"
                      >
                        {message.undoing ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Undo2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                    ) : message.undone ? (
                      <p className="absolute top-2 right-2 text-text-muted">
                        Undone
                      </p>
                    ) : null}
                    {message.undoError && (
                      <p className="mt-1 text-error">{message.undoError}</p>
                    )}
                  </div>
                ) : null}
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
                {message.skippedEdits?.length ? (
                  <ul
                    className="mt-1.5 space-y-0.5 border-t border-border-subtle pt-1 text-[10px] text-error"
                    aria-label="Edits not applied"
                  >
                    {message.skippedEdits.map((edit, index) => (
                      <li key={`${edit.filePath}-${index}`}>
                        Not applied:{" "}
                        <span className="font-mono">{edit.filePath}</span>.{" "}
                        {edit.reason}
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
                        index === all.length - 1 &&
                          "animate-pulse-soft text-text-secondary"
                      )}
                    >
                      {item}
                    </li>
                  )
                )}
              </ul>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {pendingSelection && (
        <div className="shrink-0 border-t border-border px-3 pt-2">
          <div className="flex items-start gap-2 rounded-md border border-accent-muted bg-accent-subtle px-2 py-1.5">
            <div className="min-w-0 flex-1">
              <p
                className="font-mono text-[10px] font-medium text-accent"
                data-numeric
              >
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
        onDragEnter={(event) => {
          event.preventDefault();
          if (!sending && hasContext) setIsDraggingScreenshot(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setIsDraggingScreenshot(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsDraggingScreenshot(false);
          if (!sending && hasContext) {
            void addScreenshots(event.dataTransfer.files);
          }
        }}
        className={cn(
          "shrink-0 px-3 py-2.5 transition-colors duration-150 ease-out",
          !pendingSelection && "border-t border-border",
          isDraggingScreenshot && "bg-accent-subtle"
        )}
      >
        {screenshots.length > 0 ? (
          <div
            className="mb-2 flex gap-1.5 overflow-x-auto"
            aria-label="Attached screenshots"
          >
            {screenshots.map((screenshot) => (
              <div
                key={screenshot.id}
                className="relative h-12 w-16 shrink-0 overflow-hidden rounded-md border border-border bg-bg-inset"
                title={screenshot.name}
              >
                <Image
                  src={`data:${screenshot.image.mediaType};base64,${screenshot.image.data}`}
                  alt={screenshot.name}
                  fill
                  unoptimized
                  className="object-cover"
                />
                <button
                  type="button"
                  onClick={() =>
                    setScreenshots((previous) =>
                      previous.filter((item) => item.id !== screenshot.id)
                    )
                  }
                  aria-label={`Remove ${screenshot.name}`}
                  className="absolute top-0.5 right-0.5 rounded bg-bg-elevated p-0.5 text-text-secondary shadow-xs hover:text-text-primary"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        {attachmentError ? (
          <p className="mb-1.5 text-[11px] text-error" role="alert">
            {attachmentError}
          </p>
        ) : null}
        <div className="flex items-end gap-2">
          <input
            ref={screenshotInputRef}
            type="file"
            accept={AI_IMAGE_MEDIA_TYPES.join(",")}
            multiple
            className="hidden"
            onChange={(event) => {
              if (event.currentTarget.files) {
                void addScreenshots(event.currentTarget.files);
              }
              event.currentTarget.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => screenshotInputRef.current?.click()}
            disabled={sending || !hasContext || screenshots.length >= MAX_AI_IMAGES}
            aria-label="Add screenshots"
            title="Add screenshots"
            className="btn btn-ghost h-9 w-9 shrink-0 p-0"
          >
            <ImagePlus className="h-3.5 w-3.5" />
          </button>
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
            disabled={sending || !hasContext}
            placeholder={
              hasContext ? "Ask about the selected files..." : "Select a file first"
            }
            className="input min-h-9 flex-1 resize-none overflow-y-auto px-3 py-2 text-xs leading-5"
          />
          <button
            type="submit"
            disabled={!input.trim() || sending || !hasContext}
            aria-label="Send message"
            title="Send (Enter)"
            className="btn btn-primary h-9 w-9 shrink-0 rounded-lg p-0"
          >
            {sending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
