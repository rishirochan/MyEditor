"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
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
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onCancel}
      />

      <div className="relative z-10 w-full max-w-sm rounded-lg border border-border bg-bg-primary p-5 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md p-1 text-text-muted transition-colors hover:text-text-primary hover:bg-bg-elevated"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mb-5 text-sm text-text-secondary">{message}</p>

        <div className="flex items-center justify-end gap-2">
          {!alert && (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg border border-border bg-bg-secondary px-3 py-1.5 text-sm text-text-primary transition-colors hover:bg-bg-elevated"
            >
              {cancelLabel}
            </button>
          )}
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
              variant === "danger"
                ? "bg-error text-white hover:bg-error/90"
                : "bg-accent text-bg-primary hover:bg-accent-hover"
            )}
          >
            {alert ? "OK" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
