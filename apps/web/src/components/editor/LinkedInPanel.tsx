"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { cn } from "@/lib/utils/cn";
import {
  Check,
  Copy,
  Linkedin,
  Loader2,
  Send,
  X,
} from "lucide-react";
import {
  LINKEDIN_LIMITS,
  PROFILE_SNAPSHOT_FILE,
  type LinkedInUpdate,
} from "@/lib/ai/linkedin";

interface LinkedInPanelProps {
  onClose: () => void;
  projectId: string;
  /** Resume .tex used as context — the currently open file. */
  resumePath: string | null;
  resumeContent: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
}

// ─── Update card ────────────────────────────────────

function UpdateCard({
  update,
  onSkip,
}: {
  update: LinkedInUpdate;
  onSkip: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const limit = LINKEDIN_LIMITS[update.section];
  const overLimit = update.proposed.length > limit;

  // Skipping a card shifts the list, so React can reuse this instance for a
  // different update. Clear the confirmation rather than show a stale "Copied".
  useEffect(() => setCopied(false), [update.proposed]);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(update.proposed);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked (insecure origin, denied permission). The
      // text stays selectable in the card, so this is not worth surfacing.
    }
  }, [update.proposed]);

  return (
    <div className="rounded-lg border border-border bg-bg-secondary p-3">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent">
            {update.section}
          </span>
          <p className="mt-1 truncate text-xs text-text-secondary">
            {update.label}
          </p>
        </div>
        <button
          type="button"
          onClick={onSkip}
          aria-label={`Skip ${update.label}`}
          className="shrink-0 rounded p-1 text-text-secondary transition-colors hover:bg-bg-elevated hover:text-text-primary"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {update.current ? (
        <p className="mb-2 whitespace-pre-wrap break-words rounded border border-border/60 bg-bg-tertiary p-2 text-xs text-text-secondary line-through decoration-error/50">
          {update.current}
        </p>
      ) : null}

      <p className="whitespace-pre-wrap break-words rounded border border-accent/30 bg-accent/5 p-2 text-xs text-text-primary">
        {update.proposed}
      </p>

      <div className="mt-2 flex items-center justify-between gap-2">
        <span
          className={cn(
            "text-[10px] tabular-nums",
            overLimit ? "text-error" : "text-text-secondary"
          )}
        >
          {update.proposed.length} / {limit}
          {overLimit ? " — over LinkedIn's limit" : ""}
        </span>
        <button
          type="button"
          onClick={copy}
          className="flex items-center gap-1.5 rounded-md border border-border bg-bg-tertiary px-2.5 py-1 text-xs text-text-secondary transition-colors hover:border-accent/30 hover:bg-accent/5 hover:text-accent"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5" />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              Copy
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// ─── LinkedInPanel ──────────────────────────────────

export function LinkedInPanel({
  onClose,
  projectId,
  resumePath,
  resumeContent,
}: LinkedInPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [updates, setUpdates] = useState<LinkedInUpdate[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSnapshot, setHasSnapshot] = useState<boolean | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  // Bumped whenever the context changes or a new request starts, so a reply
  // for a previous resume can never land in the current conversation.
  const requestIdRef = useRef(0);

  // The conversation is about one resume. Switching file or project makes the
  // previous thread and its suggestions meaningless — and dangerous to reuse,
  // since the next request would send the old thread with the new content.
  useEffect(() => {
    requestIdRef.current += 1;
    setMessages([]);
    setUpdates([]);
    setError(null);
    setHasSnapshot(null);
    setLoading(false);
  }, [projectId, resumePath]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, updates, loading]);

  const send = useCallback(
    async (text: string) => {
      if (!resumePath || loading) return;

      const nextMessages: Message[] = [
        ...messages,
        { role: "user", content: text },
      ];
      setMessages(nextMessages);
      setInput("");
      setLoading(true);
      setError(null);

      requestIdRef.current += 1;
      const requestId = requestIdRef.current;
      const isStale = () => requestIdRef.current !== requestId;

      try {
        const res = await fetch("/api/ai/linkedin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId,
            resumePath,
            resumeContent,
            messages: nextMessages,
          }),
        });

        const data = await res.json();
        if (isStale()) return;

        if (!res.ok) {
          throw new Error(data?.error || "Request failed");
        }

        setMessages([
          ...nextMessages,
          { role: "assistant", content: data.reply },
        ]);
        setUpdates(data.updates ?? []);
        setHasSnapshot(Boolean(data.hasProfileSnapshot));
      } catch (err) {
        if (isStale()) return;
        setError(err instanceof Error ? err.message : "Request failed");
      } finally {
        if (!isStale()) setLoading(false);
      }
    },
    [projectId, resumePath, resumeContent, messages, loading]
  );

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = input.trim();
    if (trimmed) void send(trimmed);
  };

  return (
    <aside className="flex h-full w-full flex-col border-l border-border bg-bg-primary">
      <header className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <Linkedin className="h-4 w-4 text-accent" />
          <span className="text-sm font-medium text-text-primary">
            LinkedIn from resume
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close LinkedIn panel"
          className="rounded p-1 text-text-secondary transition-colors hover:bg-bg-elevated hover:text-text-primary"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {messages.length === 0 ? (
          <div className="space-y-2 text-xs text-text-secondary">
            <p>
              Ask for LinkedIn-ready text built from{" "}
              <span className="text-text-primary">
                {resumePath ?? "the open file"}
              </span>
              . Review each change, then copy it into LinkedIn yourself.
            </p>
            <p>
              Add a{" "}
              <span className="text-text-primary">{PROFILE_SNAPSHOT_FILE}</span>{" "}
              file with your current profile text to get before/after diffs
              instead of fresh drafts.
            </p>
            <p className="text-text-secondary/70">
              LinkedIn has no API for editing your profile, so nothing here is
              posted or changed for you.
            </p>
          </div>
        ) : null}

        {messages.map((message, index) => (
          <div
            key={index}
            className={cn(
              "whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-xs",
              message.role === "user"
                ? "ml-6 bg-accent/10 text-text-primary"
                : "mr-6 bg-bg-secondary text-text-secondary"
            )}
          >
            {message.content}
          </div>
        ))}

        {hasSnapshot === false && messages.length > 0 ? (
          <p className="text-[10px] text-text-secondary">
            No {PROFILE_SNAPSHOT_FILE} in this project — showing fresh drafts
            rather than diffs.
          </p>
        ) : null}

        {updates.map((update, index) => (
          <UpdateCard
            key={`${update.section}-${update.label}-${index}`}
            update={update}
            onSkip={() =>
              setUpdates((prev) => prev.filter((_, i) => i !== index))
            }
          />
        ))}

        {loading ? (
          <div className="flex items-center gap-2 text-xs text-text-secondary">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Drafting…
          </div>
        ) : null}

        {error ? (
          <p className="rounded border border-error/30 bg-error/5 px-3 py-2 text-xs text-error">
            {error}
          </p>
        ) : null}

        <div ref={endRef} />
      </div>

      <form onSubmit={onSubmit} className="border-t border-border p-2">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                onSubmit(event);
              }
            }}
            rows={2}
            placeholder={
              resumePath
                ? "e.g. update my headline and Acme bullets"
                : "Open your resume .tex first"
            }
            disabled={!resumePath || loading}
            className="flex-1 resize-none rounded-md border border-border bg-bg-secondary px-2 py-1.5 text-xs text-text-primary placeholder:text-text-secondary/60 focus:border-accent/50 focus:outline-none disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!resumePath || loading || !input.trim()}
            aria-label="Send"
            className="rounded-md bg-accent p-2 text-bg-primary transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
      </form>
    </aside>
  );
}
