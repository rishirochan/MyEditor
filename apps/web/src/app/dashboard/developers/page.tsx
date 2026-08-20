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
import { cn } from "@/lib/utils/cn";
import {
  Key,
  Plus,
  Trash2,
  Copy,
  Check,
  Clock,
  Activity,
  AlertTriangle,
  AlertCircle,
  Loader2,
  X,
  BookOpen,
  Eye,
  EyeOff,
  ArrowRight,
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-overlay" onClick={handleClose} />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-key-title"
        className="animate-slide-up relative z-10 w-full max-w-lg rounded-xl border border-border bg-bg-primary p-6 shadow-xl"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2
              id="create-key-title"
              className="text-base font-semibold text-text-primary"
            >
              {createdKey ? "Your new API key" : "Create API key"}
            </h2>
            <p className="mt-1 text-sm text-text-secondary">
              {createdKey
                ? "Shown once. Copy it before you close this dialog."
                : "Name the key so you can recognise it later, then choose how long it should live."}
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
            className="btn btn-ghost -mt-1 -mr-1 px-2"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* The one and only reveal of the secret */}
        {createdKey && (
          <div className="space-y-4">
            <p className="flex items-start gap-2 rounded-lg bg-warning-subtle px-3 py-2.5 text-sm text-warning">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                This is the only time the full key is shown. It is stored
                hashed and cannot be retrieved later. If you lose it, revoke
                the key and create a new one.
              </span>
            </p>

            <div className="space-y-2">
              <span className="block text-xs font-medium tracking-wide text-text-muted uppercase">
                Secret key
              </span>
              <code className="block w-full rounded-lg border border-border bg-bg-inset px-3 py-3 font-mono text-sm leading-relaxed break-all text-text-primary select-all">
                {createdKey}
              </code>
              <button
                type="button"
                onClick={handleCopy}
                className={cn(
                  "btn w-full px-4 py-2.5",
                  copied ? "btn-secondary text-success" : "btn-primary"
                )}
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4" />
                    Copied to clipboard
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" />
                    Copy key
                  </>
                )}
              </button>
            </div>

            <div className="border-t border-border-subtle pt-4">
              <button
                type="button"
                onClick={handleClose}
                className="btn btn-secondary w-full px-4 py-2.5"
              >
                I have stored it, close
              </button>
            </div>
          </div>
        )}

        {/* Create form */}
        {!createdKey && (
          <>
            {error && (
              <p
                role="alert"
                className="mb-4 flex items-start gap-2 rounded-lg bg-error-subtle px-3 py-2.5 text-sm text-error"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </p>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="key-name"
                  className="block text-xs font-medium tracking-wide text-text-muted uppercase"
                >
                  Key name
                </label>
                <input
                  id="key-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  placeholder="CI pipeline, local dev, thesis script"
                  className="input"
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="key-expiry"
                  className="block text-xs font-medium tracking-wide text-text-muted uppercase"
                >
                  Expiration
                </label>
                <Select
                  value={expiresInDays || NO_EXPIRY_VALUE}
                  onValueChange={(value) =>
                    setExpiresInDays(value === NO_EXPIRY_VALUE ? "" : value)
                  }
                >
                  <SelectTrigger id="key-expiry" className="w-full bg-bg-inset">
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
                <p className="text-xs text-text-muted">
                  An expiring key limits the damage if it leaks. Optional.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-border-subtle pt-4">
                <button
                  type="button"
                  onClick={handleClose}
                  className="btn btn-ghost px-4 py-2.5"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating || !name.trim()}
                  className="btn btn-primary px-4 py-2.5"
                >
                  {creating && <Loader2 className="h-4 w-4 animate-spin" />}
                  {creating ? "Creating" : "Create key"}
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-overlay" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="revoke-key-title"
        className="animate-slide-up relative z-10 w-full max-w-sm rounded-xl border border-border bg-bg-primary p-6 shadow-xl"
      >
        <div className="flex items-start gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-error-subtle text-error">
            <AlertTriangle className="h-4 w-4" />
          </span>
          <div>
            <h2
              id="revoke-key-title"
              className="text-base font-semibold text-text-primary"
            >
              Revoke this key
            </h2>
            <p className="mt-1.5 text-sm text-text-secondary">
              <span className="font-mono text-text-primary">{keyName}</span>{" "}
              stops working immediately, and anything still using it will start
              getting 401 responses. This cannot be undone.
            </p>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2 border-t border-border-subtle pt-4">
          <button
            type="button"
            onClick={onClose}
            disabled={deleting}
            className="btn btn-ghost px-4 py-2.5"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={deleting}
            className="btn btn-danger px-4 py-2.5"
          >
            {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
            {deleting ? "Revoking" : "Revoke key"}
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
    <div className="panel flex items-start gap-4 p-4 transition-colors duration-150 hover:border-border-strong">
      <span
        className={cn(
          "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
          expired ? "bg-error-subtle text-error" : "bg-bg-inset text-accent"
        )}
      >
        <Key className="h-4 w-4" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate text-sm font-semibold text-text-primary">
            {apiKey.name}
          </h3>
          {expired && (
            <span className="inline-flex items-center gap-1 rounded-full bg-error-subtle px-2 py-0.5 text-xs font-medium text-error">
              <AlertTriangle className="h-3 w-3" />
              Expired
            </span>
          )}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-text-muted tabular-nums">
          <span className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowPrefix(!showPrefix)}
              aria-label={showPrefix ? "Hide key prefix" : "Show key prefix"}
              className="text-text-muted transition-colors hover:text-text-primary"
            >
              {showPrefix ? (
                <EyeOff className="h-3.5 w-3.5" />
              ) : (
                <Eye className="h-3.5 w-3.5" />
              )}
            </button>
            <code className="font-mono">
              {showPrefix ? `${apiKey.keyPrefix}...` : "bs_••••••••"}
            </code>
          </span>

          <span className="flex items-center gap-1.5">
            <Activity className="h-3.5 w-3.5" />
            {Number(apiKey.requestCount).toLocaleString()} requests
          </span>

          <span className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            {apiKey.lastUsedAt
              ? `Used ${formatRelativeDate(apiKey.lastUsedAt)}`
              : "Never used"}
          </span>

          <span className="flex items-center gap-1.5">
            Created {formatDate(apiKey.createdAt)}
          </span>

          {apiKey.expiresAt && (
            <span
              className={cn(
                "flex items-center gap-1.5",
                expired && "text-error"
              )}
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              {expired
                ? `Expired ${formatDate(apiKey.expiresAt)}`
                : `Expires ${formatDate(apiKey.expiresAt)}`}
            </span>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={() => onDelete(apiKey)}
        className="btn btn-ghost shrink-0 px-2 hover:bg-error-subtle hover:text-error"
        title="Revoke key"
      >
        <Trash2 className="h-4 w-4" />
        <span className="sr-only">Revoke {apiKey.name}</span>
      </button>
    </div>
  );
}

// ─── Skeleton Row ───────────────────────────────────

function SkeletonRow() {
  return (
    <div className="panel animate-pulse-soft flex items-center gap-4 p-4">
      <div className="h-9 w-9 rounded-lg bg-bg-elevated" />
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

  const origin =
    typeof window !== "undefined"
      ? window.location.origin
      : "https://your-instance.com";

  return (
    <div>
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">
            API keys
          </h1>
          <p className="mt-1.5 max-w-[70ch] text-sm text-text-secondary">
            Keys authenticate scripts and services against the MyEditor API.
            Each one carries your account access, so treat a key like a
            password.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href="/dashboard/developers/docs"
            className="btn btn-secondary px-4 py-2.5"
          >
            <BookOpen className="h-4 w-4" />
            API reference
          </Link>
          <button
            type="button"
            onClick={() => setShowCreateDialog(true)}
            className="btn btn-primary px-4 py-2.5"
          >
            <Plus className="h-4 w-4" />
            Create key
          </button>
        </div>
      </header>

      {/* Quick start */}
      <section className="panel mb-10 p-5">
        <h2 className="text-sm font-semibold text-text-primary">Quick start</h2>
        <p className="mt-1 max-w-[70ch] text-sm text-text-secondary">
          Send the key in the{" "}
          <code className="rounded bg-bg-inset px-1.5 py-0.5 font-mono text-xs text-text-primary">
            Authorization
          </code>{" "}
          header using the Bearer scheme.
        </p>
        <pre className="mt-3 overflow-x-auto rounded-lg border border-border-subtle bg-bg-inset p-3 font-mono text-xs leading-relaxed whitespace-pre text-text-secondary">
{`curl -X POST ${origin}/api/v1/compile \\
  -H "Authorization: Bearer bs_YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"source": "\\\\documentclass{article}\\n\\\\begin{document}\\nHello!\\n\\\\end{document}"}'`}
        </pre>
        <Link
          href="/dashboard/developers/docs"
          className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-accent transition-colors hover:text-accent-hover"
        >
          Read the full API reference
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </section>

      {/* Key list */}
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h2 className="text-base font-semibold text-text-primary">
          Your keys
        </h2>
        <span className="text-xs text-text-muted tabular-nums">
          {apiKeysList.length} of 10 used
        </span>
      </div>

      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      )}

      {!loading && apiKeysList.length === 0 && (
        <div className="rounded-xl border border-dashed border-border bg-bg-secondary px-6 py-12 text-center">
          <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-lg bg-bg-inset text-text-muted">
            <Key className="h-5 w-5" />
          </span>
          <h3 className="mt-4 text-base font-semibold text-text-primary">
            No API keys yet
          </h3>
          <p className="mx-auto mt-2 max-w-[60ch] text-sm text-text-secondary">
            An API key lets something outside the browser act on your account:
            a CI job that compiles your thesis on every push, a script that
            uploads figures, or your own tooling calling the compile endpoint.
            The key is shown once at creation and can be revoked at any time.
          </p>
          <button
            type="button"
            onClick={() => setShowCreateDialog(true)}
            className="btn btn-primary mt-5 px-4 py-2.5"
          >
            <Plus className="h-4 w-4" />
            Create your first key
          </button>
        </div>
      )}

      {!loading && apiKeysList.length > 0 && (
        <div className="space-y-2.5">
          {apiKeysList.map((apiKey) => (
            <ApiKeyRow
              key={apiKey.id}
              apiKey={apiKey}
              onDelete={setDeleteTarget}
            />
          ))}
        </div>
      )}

      <div className="mt-10 border-t border-border-subtle pt-6">
        <Link
          href="/dashboard"
          className="text-sm text-text-muted transition-colors hover:text-text-primary"
        >
          Back to projects
        </Link>
      </div>

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
    </div>
  );
}
