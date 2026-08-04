"use client";

import { useState, useEffect, useCallback, type FormEvent } from "react";
import Link from "next/link";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Key,
  Plus,
  Trash2,
  Copy,
  Check,
  Clock,
  Activity,
  AlertTriangle,
  Loader2,
  X,
  BookOpen,
  Eye,
  EyeOff,
  ExternalLink,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────

interface ApiKeyInfo {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: string | null;
  requestCount: string | number;
  expiresAt: string | null;
  createdAt: string;
}

// ─── Helpers ────────────────────────────────────────

function formatDate(dateString: string | null): string {
  if (!dateString) return "Never";
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRelativeDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt) < new Date();
}

// ─── Create API Key Dialog ──────────────────────────

interface CreateKeyDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

function CreateKeyDialog({ open, onClose, onCreated }: CreateKeyDialogProps) {
  const NO_EXPIRY_VALUE = "__no_expiry__";
  const [name, setName] = useState("");
  const [expiresInDays, setExpiresInDays] = useState<string>("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function resetForm() {
    setName("");
    setExpiresInDays("");
    setError("");
    setCreatedKey(null);
    setCopied(false);
  }

  function handleClose() {
    if (createdKey) {
      onCreated();
    }
    resetForm();
    onClose();
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setCreating(true);

    try {
      const body: Record<string, unknown> = { name };
      if (expiresInDays) {
        body.expiresInDays = parseInt(expiresInDays, 10);
      }

      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to create API key");
        return;
      }

      setCreatedKey(data.key);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setCreating(false);
    }
  }

  async function handleCopy() {
    if (!createdKey) return;
    await navigator.clipboard.writeText(createdKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
      />

      <div className="relative z-10 w-full max-w-lg rounded-lg border border-border bg-bg-primary p-6 shadow-xl">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-text-primary">
            {createdKey ? "API Key Created" : "Create API Key"}
          </h2>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-md p-1 text-text-muted transition-colors hover:text-text-primary hover:bg-bg-elevated"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Show created key */}
        {createdKey && (
          <div className="space-y-4">
            <div className="rounded-lg bg-success/10 border border-success/20 px-4 py-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-5 w-5 text-warning shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium text-text-primary">
                    Copy your API key now
                  </p>
                  <p className="text-text-secondary mt-1">
                    This is the only time you&apos;ll see the full key. Store it
                    securely — it cannot be retrieved later.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-lg border border-border bg-bg-secondary px-3 py-2.5 text-sm font-mono text-text-primary break-all select-all">
                {createdKey}
              </code>
              <button
                type="button"
                onClick={handleCopy}
                className="shrink-0 rounded-lg border border-border bg-bg-elevated p-2.5 text-text-secondary transition-colors hover:text-text-primary hover:bg-border"
              >
                {copied ? (
                  <Check className="h-4 w-4 text-success" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </button>
            </div>

            <button
              type="button"
              onClick={handleClose}
              className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-bg-primary transition-colors hover:bg-accent-hover"
            >
              Done
            </button>
          </div>
        )}

        {/* Create form */}
        {!createdKey && (
          <>
            {error && (
              <div className="mb-4 rounded-lg bg-error/10 px-4 py-3 text-sm text-error">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="key-name"
                  className="mb-1.5 block text-sm font-medium text-text-secondary"
                >
                  Key name
                </label>
                <input
                  id="key-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  placeholder='e.g. "CI/CD Pipeline", "Local Dev"'
                  className="w-full rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent"
                />
              </div>

              <div>
                <label
                  htmlFor="key-expiry"
                  className="mb-1.5 block text-sm font-medium text-text-secondary"
                >
                  Expiration
                  <span className="ml-1 text-text-muted font-normal">
                    (optional)
                  </span>
                </label>
                <Select
                  value={expiresInDays || NO_EXPIRY_VALUE}
                  onValueChange={(value) =>
                    setExpiresInDays(value === NO_EXPIRY_VALUE ? "" : value)
                  }
                >
                  <SelectTrigger id="key-expiry" className="w-full">
                    <SelectValue placeholder="No expiration" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_EXPIRY_VALUE}>No expiration</SelectItem>
                    <SelectItem value="7">7 days</SelectItem>
                    <SelectItem value="30">30 days</SelectItem>
                    <SelectItem value="90">90 days</SelectItem>
                    <SelectItem value="180">180 days</SelectItem>
                    <SelectItem value="365">1 year</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleClose}
                  className="rounded-lg border border-border bg-bg-elevated px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-border"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating || !name.trim()}
                  className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg-primary transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {creating ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Creating...
                    </span>
                  ) : (
                    "Create Key"
                  )}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Delete Confirmation Dialog ─────────────────────

interface DeleteKeyDialogProps {
  open: boolean;
  keyName: string;
  onClose: () => void;
  onConfirm: () => void;
  deleting: boolean;
}

function DeleteKeyDialog({
  open,
  keyName,
  onClose,
  onConfirm,
  deleting,
}: DeleteKeyDialogProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-sm rounded-lg border border-border bg-bg-primary p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-text-primary">
          Revoke API Key
        </h2>
        <p className="mt-2 text-sm text-text-secondary">
          Are you sure you want to revoke{" "}
          <span className="font-medium text-text-primary">{keyName}</span>? Any
          applications using this key will immediately lose access.
        </p>
        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={deleting}
            className="rounded-lg border border-border bg-bg-elevated px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-border disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={deleting}
            className="rounded-lg bg-error px-4 py-2 text-sm font-medium text-bg-primary transition-colors hover:bg-error/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {deleting ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Revoking...
              </span>
            ) : (
              "Revoke Key"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── API Key Row ────────────────────────────────────

interface ApiKeyRowProps {
  apiKey: ApiKeyInfo;
  onDelete: (key: ApiKeyInfo) => void;
}

function ApiKeyRow({ apiKey, onDelete }: ApiKeyRowProps) {
  const [showPrefix, setShowPrefix] = useState(false);
  const expired = isExpired(apiKey.expiresAt);

  return (
    <div className="flex items-center gap-4 rounded-lg border border-border bg-bg-secondary p-4 transition-colors hover:bg-bg-elevated/50">
      {/* Key icon */}
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-bg-elevated">
        <Key className={`h-5 w-5 ${expired ? "text-error" : "text-accent"}`} />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-text-primary truncate">
            {apiKey.name}
          </h3>
          {expired && (
            <span className="inline-flex items-center rounded-full bg-error/10 px-2 py-0.5 text-xs font-medium text-error">
              Expired
            </span>
          )}
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-muted">
          {/* Key prefix */}
          <span className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setShowPrefix(!showPrefix)}
              className="text-text-muted hover:text-text-secondary transition-colors"
            >
              {showPrefix ? (
                <EyeOff className="h-3 w-3" />
              ) : (
                <Eye className="h-3 w-3" />
              )}
            </button>
            <code className="font-mono">
              {showPrefix ? `${apiKey.keyPrefix}...` : "bs_••••••••"}
            </code>
          </span>

          {/* Request count */}
          <span className="flex items-center gap-1">
            <Activity className="h-3 w-3" />
            {Number(apiKey.requestCount).toLocaleString()} requests
          </span>

          {/* Last used */}
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {apiKey.lastUsedAt
              ? `Used ${formatRelativeDate(apiKey.lastUsedAt)}`
              : "Never used"}
          </span>

          {/* Expiry */}
          {apiKey.expiresAt && (
            <span
              className={`flex items-center gap-1 ${expired ? "text-error" : ""}`}
            >
              <AlertTriangle className="h-3 w-3" />
              {expired
                ? `Expired ${formatDate(apiKey.expiresAt)}`
                : `Expires ${formatDate(apiKey.expiresAt)}`}
            </span>
          )}
        </div>
      </div>

      {/* Delete button */}
      <button
        type="button"
        onClick={() => onDelete(apiKey)}
        className="shrink-0 rounded-md p-2 text-text-muted transition-colors hover:text-error hover:bg-error/10"
        title="Revoke key"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

// ─── Skeleton Row ───────────────────────────────────

function SkeletonRow() {
  return (
    <div className="flex items-center gap-4 rounded-lg border border-border bg-bg-secondary p-4 animate-pulse">
      <div className="h-10 w-10 rounded-lg bg-bg-elevated" />
      <div className="flex-1 space-y-2">
        <div className="h-4 w-32 rounded bg-bg-elevated" />
        <div className="h-3 w-64 rounded bg-bg-elevated" />
      </div>
      <div className="h-8 w-8 rounded bg-bg-elevated" />
    </div>
  );
}

// ─── Developer Dashboard Page ───────────────────────

export default function DeveloperDashboardPage() {
  const [apiKeysList, setApiKeysList] = useState<ApiKeyInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ApiKeyInfo | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchKeys = useCallback(async () => {
    try {
      const res = await fetch("/api/keys");
      if (res.ok) {
        const data = await res.json();
        setApiKeysList(data.apiKeys);
      }
    } catch {
      // Silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);

    try {
      const res = await fetch(`/api/keys/${deleteTarget.id}`, {
        method: "DELETE",
      });

      if (res.ok) {
        setApiKeysList((prev) => prev.filter((k) => k.id !== deleteTarget.id));
      }
    } catch {
      // Silently fail
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }

  return (
    <>
      {/* Page header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">
            Developer Settings
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Manage API keys and integrate with the Backslash API
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/developers/docs"
            className="flex items-center gap-2 rounded-lg border border-border bg-bg-elevated px-4 py-2.5 text-sm font-medium text-text-primary transition-colors hover:bg-border"
          >
            <BookOpen className="h-4 w-4" />
            API Docs
          </Link>
          <button
            type="button"
            onClick={() => setShowCreateDialog(true)}
            className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-bg-primary transition-colors hover:bg-accent-hover"
          >
            <Plus className="h-4 w-4" />
            Create API Key
          </button>
        </div>
      </div>

      {/* Quick start card */}
      <div className="mb-8 rounded-lg border border-accent/20 bg-accent/5 p-5">
        <h2 className="text-sm font-semibold text-text-primary mb-2">
          Quick Start
        </h2>
        <p className="text-sm text-text-secondary mb-3">
          Use your API key to compile LaTeX documents programmatically. Include
          the key in the <code className="text-accent font-mono text-xs">Authorization</code> header:
        </p>
        <div className="rounded-lg bg-bg-secondary border border-border p-3 font-mono text-xs text-text-secondary overflow-x-auto">
          <pre className="whitespace-pre">
{`curl -X POST ${typeof window !== "undefined" ? window.location.origin : "https://your-instance.com"}/api/v1/compile \\
  -H "Authorization: Bearer bs_YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"source": "\\\\documentclass{article}\\n\\\\begin{document}\\nHello!\\n\\\\end{document}"}'`}
          </pre>
        </div>
        <div className="mt-3 flex items-center gap-4">
          <Link
            href="/dashboard/developers/docs"
            className="text-sm font-medium text-accent hover:text-accent-hover transition-colors flex items-center gap-1"
          >
            View full documentation
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      {/* API Keys list */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-text-primary">API Keys</h2>
        <span className="text-sm text-text-muted">
          {apiKeysList.length} / 10 keys
        </span>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && apiKeysList.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-bg-secondary/50 px-6 py-16">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-bg-elevated">
            <Key className="h-7 w-7 text-text-muted" />
          </div>
          <h3 className="mt-4 text-lg font-medium text-text-primary">
            No API keys
          </h3>
          <p className="mt-1 text-sm text-text-secondary text-center max-w-sm">
            Create an API key to start using the Backslash API for programmatic
            LaTeX compilation and project management.
          </p>
          <button
            type="button"
            onClick={() => setShowCreateDialog(true)}
            className="mt-6 flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-bg-primary transition-colors hover:bg-accent-hover"
          >
            <Plus className="h-4 w-4" />
            Create API Key
          </button>
        </div>
      )}

      {/* Keys list */}
      {!loading && apiKeysList.length > 0 && (
        <div className="space-y-3">
          {apiKeysList.map((apiKey) => (
            <ApiKeyRow
              key={apiKey.id}
              apiKey={apiKey}
              onDelete={setDeleteTarget}
            />
          ))}
        </div>
      )}

      {/* Back link */}
      <div className="mt-8 pt-6 border-t border-border">
        <Link
          href="/dashboard"
          className="text-sm text-text-muted hover:text-text-primary transition-colors"
        >
          ← Back to Projects
        </Link>
      </div>

      {/* Dialogs */}
      <CreateKeyDialog
        open={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        onCreated={fetchKeys}
      />

      <DeleteKeyDialog
        open={deleteTarget !== null}
        keyName={deleteTarget?.name ?? ""}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        deleting={deleting}
      />
    </>
  );
}
