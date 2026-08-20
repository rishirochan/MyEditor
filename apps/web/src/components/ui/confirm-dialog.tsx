"use client";

import { useEffect, useRef } from "react";
import { AlertTriangle, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "default";
  /** When true, only shows a single dismiss button (alert mode). */
  alert?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  alert = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) {
      confirmRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onCancel();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-overlay animate-fade-in"
        onClick={onCancel}
      />

      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        className="relative z-10 w-full max-w-sm rounded-xl border border-border bg-bg-secondary p-5 shadow-xl animate-slide-up"
      >
        <div className="mb-2 flex items-start justify-between gap-4">
          <div className="flex items-center gap-2.5">
            {variant === "danger" && (
              <AlertTriangle className="h-4 w-4 shrink-0 text-error" />
            )}
            <h3
              id="confirm-dialog-title"
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

        <p
          id="confirm-dialog-message"
          className="mb-5 max-w-[52ch] text-sm leading-relaxed text-text-secondary"
        >
          {message}
        </p>

        <div className="flex items-center justify-end gap-2">
          {!alert && (
            <button
              type="button"
              onClick={onCancel}
              className="btn btn-secondary"
            >
              {cancelLabel}
            </button>
          )}
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className={cn(
              "btn",
              variant === "danger" ? "btn-danger" : "btn-primary"
            )}
          >
            {alert ? "OK" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
