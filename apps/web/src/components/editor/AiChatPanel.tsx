"use client";

import { useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import Link from "next/link";
import Image from "next/image";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils/cn";
import { isAbortError } from "@/lib/ai/abort";
import {
  effortLabel,
  normalizeEffort,
  type CliModelOption,
} from "@/lib/ai/cliModelCatalog";
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
  ChevronsUpDown,
  ImagePlus,
  Loader2,
  MessageSquare,
  PencilLine,
  Send,
  Sparkles,
  Square,
  Trash2,
  Undo2,
  X,
} from "lucide-react";

const MAX_CONTEXT_FILES = 2;

type AiMode = "contour" | "carve";

const DEFAULT_AI_MODE: AiMode = "carve";

const AI_MODES = [
  {
    id: "contour",
    label: "Contour",
    Icon: MessageSquare,
    hint: "Contour: discuss only, never edits your files",
  },
  {
    id: "carve",
    label: "Carve",
    Icon: PencilLine,
    hint: "Carve: may edit the selected files when the request calls for it",
  },
] as const;

function isAiMode(value: unknown): value is AiMode {
  return value === "contour" || value === "carve";
}

interface ChatModelState {
  provider: string;
  model: string;
  effort: string | null;
  services: Array<{ id: string; label: string }>;
  options: CliModelOption[];
}

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
  cancelled?: boolean;
  mode?: AiMode;
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

interface ActivityItem {
  message: string;
  label?: string;
  tool?: string;
}

type ChatEvent =
  | {
      type: "activity";
      message: string;
      append?: boolean;
      label?: string;
      tool?: string;
    }
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

/* Plain chat text highlights fenced blocks, backticks and LaTeX commands.
   Assistant replies use the Markdown renderer below. */
const CODE_PARTS = /(```[\s\S]*?```|`[^`\n]+`|\\[a-zA-Z@]+\*?)/g;
const PLAIN_CODE_PARTS = /(```[\s\S]*?```|`[^`\n]+`)/g;

export function MessageText({
  text,
  highlightLatex = true,
}: {
  text: string;
  highlightLatex?: boolean;
}) {
  return (
    <>
      {text.split(highlightLatex ? CODE_PARTS : PLAIN_CODE_PARTS).map((part, index) => {
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

function MarkdownMessage({ text }: { text: string }) {
  return (
    <div className="min-w-0 whitespace-normal break-words [&_a]:text-accent [&_a]:underline [&_a]:underline-offset-2 [&_blockquote]:my-2 [&_blockquote]:rounded-md [&_blockquote]:bg-bg-inset [&_blockquote]:px-3 [&_blockquote]:py-2 [&_code]:rounded [&_code]:bg-bg-inset [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[11px] [&_h1]:mb-2 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:my-2 [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:my-2 [&_h3]:font-semibold [&_hr]:my-3 [&_hr]:border-border-subtle [&_li]:my-0.5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-bg-inset [&_pre]:p-2 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_strong]:font-semibold [&_strong]:text-text-primary [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-[32rem] border-collapse text-left [&_tbody_tr:last-child_td]:border-b-0">
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border-b border-border bg-bg-inset px-2.5 py-2 align-top font-semibold text-text-primary">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-b border-border-subtle px-2.5 py-2 align-top">
              {children}
            </td>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
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
  onActivity: (activity: ActivityItem[]) => void
): Promise<ChatResponse> {
  const activity: ActivityItem[] = [];
  let result: ChatResult | undefined;
  let errorMessage: string | undefined;

  if (response.headers.get("content-type")?.includes("application/x-ndjson")) {
    await readNdjson(response, (streamEvent) => {
      if (streamEvent.type === "activity") {
        if (streamEvent.append && activity.length > 0) {
          const last = activity[activity.length - 1];
          activity[activity.length - 1] = {
            ...last,
            message: last.message + streamEvent.message,
          };
        } else {
          activity.push({
            message: streamEvent.message,
            label: streamEvent.label,
            tool: streamEvent.tool,
          });
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

  return {
    activity: activity.map((item) => item.message),
    errorMessage,
    result,
  };
}

function liveStatusLabel(items: ActivityItem[]): string {
  const last = items[items.length - 1];
  if (!last) return "Starting...";
  if (last.tool) return `Calling ${last.tool}`;
  if (last.label) return last.label;
  return last.message || "Starting...";
}

function isFileDrag(event: DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes("Files");
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

const ROLLER_ROW_HEIGHT = 24;
const ROLLER_WHEEL_STEP = 28;

/**
 * A one-row drum: the selection sits in the window and the rest of the list
 * lives above and below it. Wheel nudges one step at a time; the invisible
 * native select on top keeps click, touch, and keyboard behaviour intact.
 */
function OptionRoller({
  label,
  options,
  value,
  disabled,
  onSelect,
}: {
  label: string;
  options: Array<{ id: string; label: string; title?: string }>;
  value: string | null;
  disabled: boolean;
  onSelect: (id: string) => void;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const stepRef = useRef<(direction: number) => void>(() => {});

  const index = Math.max(
    0,
    options.findIndex((option) => option.id === value)
  );

  useEffect(() => {
    stepRef.current = (direction: number) => {
      const next = index + direction;
      if (next < 0 || next >= options.length) return;
      const target = options[next];
      if (target && target.id !== value) onSelect(target.id);
    };
  });

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || disabled) return;

    let travelled = 0;
    let resetTimer: ReturnType<typeof setTimeout> | undefined;

    function handleWheel(event: WheelEvent) {
      // A vertical gesture here belongs to the drum, not the panel behind it.
      if (Math.abs(event.deltaY) < Math.abs(event.deltaX)) return;
      event.preventDefault();

      travelled += event.deltaY;
      while (Math.abs(travelled) >= ROLLER_WHEEL_STEP) {
        const direction = travelled > 0 ? 1 : -1;
        travelled -= direction * ROLLER_WHEEL_STEP;
        stepRef.current(direction);
      }

      // Trackpad momentum leaves a remainder that would leak into the next flick.
      clearTimeout(resetTimer);
      resetTimer = setTimeout(() => {
        travelled = 0;
      }, 140);
    }

    frame.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      clearTimeout(resetTimer);
      frame.removeEventListener("wheel", handleWheel);
    };
  }, [disabled]);

  if (options.length === 0) return null;

  const active = options[index];

  return (
    <div
      ref={frameRef}
      title={active?.title ?? active?.label}
      className={cn(
        "group relative shrink-0 rounded-lg border border-border bg-bg-inset p-0.5",
        "transition-colors duration-150 ease-out",
        "focus-within:border-accent hover:border-border-strong",
        disabled && "opacity-45"
      )}
    >
      <div
        className="overflow-hidden"
        style={{ height: ROLLER_ROW_HEIGHT }}
        aria-hidden="true"
      >
        <div
          className="motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-out"
          style={{ transform: `translateY(${-index * ROLLER_ROW_HEIGHT}px)` }}
        >
          {options.map((option) => (
            <div
              key={option.id}
              className="flex items-center pr-4 pl-1.5 text-[11px] font-medium whitespace-nowrap text-text-secondary"
              style={{ height: ROLLER_ROW_HEIGHT }}
            >
              {option.label}
            </div>
          ))}
        </div>
      </div>

      <ChevronsUpDown className="pointer-events-none absolute top-1/2 right-1 h-2.5 w-2.5 -translate-y-1/2 text-text-muted transition-colors duration-150 ease-out group-hover:text-text-secondary" />

      <select
        aria-label={label}
        value={active?.id ?? ""}
        disabled={disabled}
        onChange={(event) => onSelect(event.target.value)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
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
  const [mode, setMode] = useState<AiMode>(DEFAULT_AI_MODE);
  const [chatModel, setChatModel] = useState<ChatModelState | null>(null);
  const [chatModelBusy, setChatModelBusy] = useState(false);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
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
  const loadedModeKeyRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const dragDepthRef = useRef(0);
  const storageKey = `ai-chat-v2:${projectId}`;
  const contextStorageKey = `ai-context:${projectId}`;
  const modeStorageKey = `ai-mode:${projectId}`;
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
    if (loadedModeKeyRef.current !== modeStorageKey) {
      loadedModeKeyRef.current = modeStorageKey;
      let stored: string | null = null;
      try {
        stored = window.localStorage.getItem(modeStorageKey);
      } catch {
        // Browser storage is optional.
      }
      setMode(isAiMode(stored) ? stored : DEFAULT_AI_MODE);
      return;
    }
    try {
      window.localStorage.setItem(modeStorageKey, mode);
    } catch {
      // Browser storage is optional.
    }
  }, [mode, modeStorageKey]);

  useEffect(() => {
    if (configured === false) return;
    let cancelled = false;
    fetch("/api/ai/chat-model", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: ChatModelState | null) => {
        if (!cancelled && data) setChatModel(data);
      })
      .catch(() => {
        // The picker stays hidden when settings cannot be read.
      });
    return () => {
      cancelled = true;
    };
  }, [configured]);

  useEffect(() => {
    setScreenshots([]);
    setAttachmentError(null);
  }, [projectId]);

  useEffect(() => {
    if (!sending) return;
    dragDepthRef.current = 0;
    setIsDraggingScreenshot(false);
  }, [sending]);

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
        mode,
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
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
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
    } catch (error) {
      if (isAbortError(error)) {
        setMessages((previous) =>
          previous.map((entry) =>
            entry.id === message.id
              ? { ...entry, undoing: false, undoError: undefined }
              : entry
          )
        );
        return;
      }
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
      if (abortRef.current === controller) abortRef.current = null;
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
      mode,
    };
    const history = [...messages, userMessage]
      .filter((message) => !message.error && !message.cancelled)
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
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          projectId,
          mode,
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
            mode,
          },
        ]);
        return;
      }

      applyResult(chatResponse.result, chatResponse.activity);
    } catch (error) {
      if (isAbortError(error)) {
        setMessages((previous) => [
          ...previous,
          {
            id: nextMessageId(),
            role: "assistant",
            content: "Stopped.",
            cancelled: true,
            mode,
          },
        ]);
        return;
      }
      setMessages((previous) => [
        ...previous,
        {
          id: nextMessageId(),
          role: "assistant",
          content: "Network error. Please try again.",
          error: true,
          mode,
        },
      ]);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setActivity([]);
      setSending(false);
    }
  }

  function handleStop() {
    abortRef.current?.abort();
  }

  async function updateChatModel(next: {
    provider?: string;
    model?: string;
    effort?: string | null;
  }) {
    if (!chatModel || chatModelBusy) return;
    const previous = chatModel;
    setChatModel({ ...chatModel, ...next });
    setChatModelBusy(true);
    try {
      const response = await fetch("/api/ai/chat-model", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!response.ok) throw new Error("Model update failed");
      setChatModel((await response.json()) as ChatModelState);
    } catch {
      setChatModel(previous);
    } finally {
      setChatModelBusy(false);
    }
  }

  function selectChatService(provider: string) {
    if (!chatModel || provider === chatModel.provider) return;
    void updateChatModel({ provider });
  }

  function selectChatModel(model: string) {
    if (!chatModel || model === chatModel.model) return;
    void updateChatModel({
      model,
      effort: normalizeEffort(chatModel.effort, chatModel.options, model),
    });
  }

  function selectChatEffort(effort: string) {
    if (!chatModel || effort === chatModel.effort) return;
    void updateChatModel({ model: chatModel.model, effort });
  }

  function resetScreenshotDrag() {
    dragDepthRef.current = 0;
    setIsDraggingScreenshot(false);
  }

  function handleScreenshotDragEnter(event: DragEvent<HTMLFormElement>) {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current += 1;
    if (!sending && hasContext && isFileDrag(event)) {
      setIsDraggingScreenshot(true);
    }
  }

  function handleScreenshotDragOver(event: DragEvent<HTMLFormElement>) {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleScreenshotDragLeave(event: DragEvent<HTMLFormElement>) {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDraggingScreenshot(false);
  }

  function handleScreenshotDrop(event: DragEvent<HTMLFormElement>) {
    event.preventDefault();
    event.stopPropagation();
    resetScreenshotDrag();
    if (!sending && hasContext) {
      void addScreenshots(event.dataTransfer.files);
    }
  }

  const folderLabel = folderPath ? `${folderPath}/` : "project root";
  const modelOptions = chatModel?.options ?? [];
  const effortOptions =
    modelOptions.find((option) => option.id === chatModel?.model)?.efforts ?? [];

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
                  "rounded-lg px-2.5 py-1.5 text-xs leading-relaxed",
                  message.role === "user" && "whitespace-pre-wrap",
                  message.role === "user"
                    ? "max-w-[85%] bg-accent-subtle text-text-primary"
                    : message.error
                      ? "max-w-[95%] border border-error bg-error-subtle text-error"
                      : message.cancelled
                        ? "max-w-[95%] bg-bg-elevated text-text-muted"
                        : "max-w-[95%] bg-bg-elevated text-text-secondary"
                )}
              >
                {message.role === "user" && message.mode === "contour" && (
                  <p className="mb-1 inline-flex items-center gap-1 text-[10px] font-medium text-text-muted">
                    <MessageSquare className="h-2.5 w-2.5" />
                    Contour
                  </p>
                )}
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
                {message.role === "assistant" ? (
                  <MarkdownMessage text={message.content} />
                ) : (
                  <MessageText
                    text={message.content}
                    highlightLatex={message.mode !== "contour"}
                  />
                )}
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
                <span className="animate-pulse-soft">
                  {liveStatusLabel(activity)}
                </span>
              </div>
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
        onDragEnter={handleScreenshotDragEnter}
        onDragOver={handleScreenshotDragOver}
        onDragLeave={handleScreenshotDragLeave}
        onDrop={handleScreenshotDrop}
        className={cn(
          "relative shrink-0 px-3 py-2.5 transition-colors duration-150 ease-out",
          !pendingSelection && "border-t border-border",
          isDraggingScreenshot && "bg-accent-subtle"
        )}
      >
        {isDraggingScreenshot ? (
          <div
            className="pointer-events-none absolute inset-1 z-10 flex items-center justify-center rounded-lg border border-dashed border-accent bg-accent-subtle"
            aria-hidden
          >
            <p className="text-[11px] font-medium text-accent">
              Drop screenshots
            </p>
          </div>
        ) : null}
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
            mode === "contour"
              ? "Ask about the selected files..."
              : "Ask for a change to the selected files..."
          }
          className="input min-h-9 w-full resize-none overflow-y-auto px-3 py-2 text-xs leading-5"
        />
        <div className="mt-2 flex items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div
              role="radiogroup"
              aria-label="AI mode"
              className="flex shrink-0 items-center gap-0.5 rounded-lg border border-border bg-bg-inset p-0.5"
            >
              {AI_MODES.map((option) => {
                const active = mode === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={sending}
                    onClick={() => setMode(option.id)}
                    title={option.hint}
                    className={cn(
                      "inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium",
                      "transition-colors duration-150 ease-out",
                      "disabled:cursor-not-allowed disabled:opacity-45",
                      active
                        ? "bg-accent-subtle text-accent"
                        : "text-text-muted hover:text-text-secondary"
                    )}
                  >
                    <option.Icon className="h-3 w-3 shrink-0" />
                    {option.label}
                  </button>
                );
              })}
            </div>
            <OptionRoller
              label="Service"
              options={chatModel?.services ?? []}
              value={chatModel?.provider ?? null}
              disabled={sending || chatModelBusy}
              onSelect={selectChatService}
            />
            <OptionRoller
              label="Model"
              options={modelOptions.map((option) => ({
                id: option.id,
                label: option.label,
              }))}
              value={chatModel?.model ?? null}
              disabled={sending || chatModelBusy}
              onSelect={selectChatModel}
            />
            <OptionRoller
              label="Thinking level"
              options={effortOptions.map((level) => ({
                id: level.effort,
                label: effortLabel(level.effort),
                title: level.description ?? effortLabel(level.effort),
              }))}
              value={chatModel?.effort ?? null}
              disabled={sending || chatModelBusy}
              onSelect={selectChatEffort}
            />
          </div>
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
            className="btn btn-ghost h-8 w-8 shrink-0 p-0"
          >
            <ImagePlus className="h-3.5 w-3.5" />
          </button>
          {sending ? (
            <button
              type="button"
              onClick={handleStop}
              aria-label="Stop"
              title="Stop"
              className="btn btn-primary h-8 w-8 shrink-0 rounded-lg p-0"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim() || !hasContext}
              aria-label="Send message"
              title="Send (Enter)"
              className="btn btn-primary h-8 w-8 shrink-0 rounded-lg p-0"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
