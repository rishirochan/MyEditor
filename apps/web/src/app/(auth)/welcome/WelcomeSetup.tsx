"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { AlertCircle, Check, Loader2 } from "lucide-react";

interface TexStatus {
  installed: boolean;
  status: "idle" | "downloading" | "extracting" | "done" | "error";
  progress: number;
  error: string | null;
}

function texLabel(tex: TexStatus): string {
  if (tex.installed) return "LaTeX is ready";
  if (tex.status === "extracting") return "Unpacking LaTeX";
  if (tex.status === "error") return "LaTeX couldn't be installed";
  if (tex.progress > 0) return `Downloading LaTeX, ${Math.round(tex.progress * 100)}%`;
  return "Downloading LaTeX";
}

export function WelcomeSetup({
  needsName,
  texInstalled,
}: {
  needsName: boolean;
  texInstalled: boolean;
}) {
  const [tex, setTex] = useState<TexStatus>({
    installed: texInstalled,
    status: "idle",
    progress: 0,
    error: null,
  });
  const [nameSaved, setNameSaved] = useState(!needsName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const startTexInstall = useCallback(async () => {
    const res = await fetch("/api/setup", { method: "POST" });
    if (res.ok) setTex((await res.json()).tex);
  }, []);

  // The download takes a minute or two, so it starts right away, while the
  // user is still typing their name.
  useEffect(() => {
    if (!texInstalled) void startTexInstall();
  }, [texInstalled, startTexInstall]);

  useEffect(() => {
    if (tex.installed || tex.status === "error") return;
    const timer = setInterval(async () => {
      const res = await fetch("/api/setup");
      if (res.ok) setTex((await res.json()).tex);
    }, 1000);
    return () => clearInterval(timer);
  }, [tex.installed, tex.status]);

  useEffect(() => {
    if (nameSaved && tex.installed) window.location.href = "/dashboard";
  }, [nameSaved, tex.installed]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (nameSaved) return;
    setError("");
    setSaving(true);
    const name = String(new FormData(e.currentTarget).get("name") || "").trim();
    try {
      const res = await fetch("/api/setup/user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        setError((await res.json()).error || "Something went wrong.");
        return;
      }
      setNameSaved(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const waitingForTex = nameSaved && !tex.installed;

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight text-text-primary">
        Welcome to MyEditor
      </h1>
      <p className="mt-1.5 text-sm text-text-secondary">
        {needsName
          ? "One question, and you're writing. Everything stays on this Mac."
          : "MyEditor needs LaTeX to turn your documents into PDFs. This happens once."}
      </p>

      {error && (
        <div
          role="alert"
          className="mt-6 flex items-start gap-2.5 rounded-lg bg-error-subtle px-3.5 py-3 text-sm text-error"
        >
          <AlertCircle className="mt-px h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-7 space-y-5">
        {needsName && (
          <div className="space-y-2">
            <label
              htmlFor="name"
              className="block text-xs font-medium tracking-wide text-text-muted uppercase"
            >
              Your name
            </label>
            <input
              id="name"
              name="name"
              type="text"
              required
              maxLength={255}
              autoFocus
              autoComplete="name"
              placeholder="Ada Lovelace"
              disabled={nameSaved}
              className="input"
            />
          </div>
        )}

        <div className="rounded-lg border border-border-subtle px-3.5 py-3" aria-live="polite">
          <div className="flex items-center gap-2.5 text-sm text-text-secondary">
            {tex.installed ? (
              <Check className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
            ) : tex.status === "error" ? (
              <AlertCircle className="h-4 w-4 shrink-0 text-error" aria-hidden="true" />
            ) : (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
            )}
            <span>{texLabel(tex)}</span>
          </div>
          {!tex.installed && tex.status !== "error" && (
            <div
              className="mt-2.5 h-1 overflow-hidden rounded-full bg-bg-tertiary"
              role="progressbar"
              aria-label="LaTeX download"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(tex.progress * 100)}
            >
              <div
                className="h-full bg-accent transition-[width] duration-500"
                style={{ width: `${Math.max(tex.progress, 0.03) * 100}%` }}
              />
            </div>
          )}
          {tex.status === "error" && (
            <div className="mt-2 space-y-2 text-xs text-text-muted">
              <p>{tex.error} Check your internet connection and try again.</p>
              <button type="button" onClick={startTexInstall} className="btn btn-ghost">
                Try again
              </button>
            </div>
          )}
        </div>

        {needsName && (
          <button
            type="submit"
            disabled={saving || nameSaved}
            aria-busy={saving || waitingForTex}
            className="btn btn-primary w-full py-2.5"
          >
            {(saving || waitingForTex) && (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            )}
            {waitingForTex ? "Finishing LaTeX setup" : "Start writing"}
          </button>
        )}
      </form>
    </div>
  );
}
