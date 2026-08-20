"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { AlertCircle, Loader2, ShieldCheck, X } from "lucide-react";
import { PasswordInput } from "@/components/ui/password-input";

interface PasswordPromptDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  errorMessage?: string | null;
  submitting?: boolean;
  onConfirm: (password: string) => void;
  onCancel: () => void;
}

export function PasswordPromptDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  errorMessage,
  submitting = false,
  onConfirm,
  onCancel,
}: PasswordPromptDialogProps) {
  const [password, setPassword] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setPassword("");
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onCancel]);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!password) return;
    onConfirm(password);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-overlay animate-fade-in"
        onClick={onCancel}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="password-prompt-title"
        className="relative z-10 w-full max-w-sm rounded-xl border border-border bg-bg-secondary p-5 shadow-xl animate-slide-up"
      >
        <div className="mb-2 flex items-start justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="h-4 w-4 shrink-0 text-text-muted" />
            <h3
              id="password-prompt-title"
              className="text-sm font-semibold text-text-primary"
            >
              {title}
            </h3>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            className="-mr-1 -mt-1 rounded-md p-1 text-text-muted transition-colors duration-150 ease-out hover:bg-bg-elevated hover:text-text-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mb-4 max-w-[52ch] text-sm leading-relaxed text-text-secondary">
          {message}
        </p>

        <form onSubmit={handleSubmit}>
          <PasswordInput
            ref={inputRef}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Current password"
            autoComplete="current-password"
            aria-invalid={errorMessage ? true : undefined}
          />

          {errorMessage && (
            <p
              role="alert"
              className="mt-2 flex items-start gap-2 rounded-md bg-error-subtle px-2.5 py-2 text-sm text-error"
            >
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{errorMessage}</span>
            </p>
          )}

          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="btn btn-secondary"
            >
              {cancelLabel}
            </button>
            <button
              type="submit"
              disabled={submitting || !password}
              className="btn btn-primary"
            >
              {submitting && (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              )}
              {submitting ? "Verifying..." : confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
