"use client";

import { useState, useEffect, useCallback, type FormEvent } from "react";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Clock3,
  Copy,
  Crown,
  Eye,
  Globe,
  Link2,
  Loader2,
  Pencil,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type ShareRole = "viewer" | "editor";
type ExpiryOption = "30m" | "7d" | "never";

interface Collaborator {
  id: string;
  userId: string;
  email: string;
  name: string;
  role: ShareRole;
  createdAt: string;
  expiresAt: string | null;
}

interface Owner {
  userId: string;
  email: string;
  name: string;
}

interface PublicShare {
  enabled: boolean;
  role: ShareRole;
  expiresAt: string | null;
  token: string | null;
  url: string | null;
}

interface ShareDialogProps {
  projectId: string;
  projectName: string;
  open: boolean;
  onClose: () => void;
  isOwner: boolean;
  onChanged?: () => void;
}

function mapExpiryToOption(expiresAt: string | null): ExpiryOption {
  if (!expiresAt) return "never";
  const diffMs = new Date(expiresAt).getTime() - Date.now();
  if (diffMs <= 0) return "never";
  if (diffMs <= 35 * 60 * 1000) return "30m";
  if (diffMs <= 8 * 24 * 60 * 60 * 1000) return "7d";
  return "never";
}

function formatExpiry(expiresAt: string | null): string {
  if (!expiresAt) return "Never expires";
  return `Expires ${new Date(expiresAt).toLocaleString()}`;
}

export function ShareDialog({
  projectId,
  projectName,
  open,
  onClose,
  isOwner,
  onChanged,
}: ShareDialogProps) {
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [owner, setOwner] = useState<Owner | null>(null);
  const [loading, setLoading] = useState(false);

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<ShareRole>("editor");
  const [inviteExpiry, setInviteExpiry] = useState<ExpiryOption>("never");
  const [inviting, setInviting] = useState(false);

  const [publicEnabled, setPublicEnabled] = useState(false);
  const [publicRole, setPublicRole] = useState<ShareRole>("viewer");
  const [publicExpiry, setPublicExpiry] = useState<ExpiryOption>("never");
  const [publicUrl, setPublicUrl] = useState<string | null>(null);
  const [updatingPublic, setUpdatingPublic] = useState(false);
  const [copiedPublicUrl, setCopiedPublicUrl] = useState(false);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const fetchCollaborators = useCallback(async () => {
    setLoading(true);
    try {
      const [collabRes, publicRes] = await Promise.all([
        fetch(`/api/projects/${projectId}/collaborators`, { cache: "no-store" }),
        fetch(`/api/projects/${projectId}/share-link`, { cache: "no-store" }),
      ]);

      if (collabRes.ok) {
        const data = await collabRes.json();
        setCollaborators(data.collaborators ?? []);
        setOwner(data.owner ?? null);
      }

      if (publicRes.ok) {
        const data = await publicRes.json();
        const share = (data.share ?? {
          enabled: false,
          role: "viewer",
          expiresAt: null,
          token: null,
          url: null,
        }) as PublicShare;
        setPublicEnabled(share.enabled);
        setPublicRole(share.role);
        setPublicExpiry(mapExpiryToOption(share.expiresAt));
        setPublicUrl(share.url ?? null);
      }
    } catch {
      // Silently fail
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (open) {
      fetchCollaborators();
      setError("");
      setSuccess("");
      setEmail("");
      setCopiedPublicUrl(false);
    }
  }, [open, fetchCollaborators]);

  async function handleInvite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setInviting(true);

    try {
      const res = await fetch(`/api/projects/${projectId}/collaborators`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          role,
          expiresIn: inviteExpiry,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to invite collaborator");
        return;
      }

      setSuccess(
        data.updated
          ? `Updated ${data.collaborator.name}'s access`
          : `Shared with ${data.collaborator.email}`
      );
      setEmail("");
      await fetchCollaborators();
      onChanged?.();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setInviting(false);
    }
  }

  async function handleRemove(shareId: string) {
    try {
      const res = await fetch(
        `/api/projects/${projectId}/collaborators/${shareId}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        setCollaborators((prev) => prev.filter((c) => c.id !== shareId));
        onChanged?.();
      }
    } catch {
      // Silently fail
    }
  }

  async function handleRoleChange(shareId: string, newRole: ShareRole) {
    try {
      const res = await fetch(
        `/api/projects/${projectId}/collaborators/${shareId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: newRole }),
        }
      );
      if (res.ok) {
        setCollaborators((prev) =>
          prev.map((c) => (c.id === shareId ? { ...c, role: newRole } : c))
        );
        onChanged?.();
      }
    } catch {
      // Silently fail
    }
  }

  async function handlePublicShareSave() {
    setError("");
    setSuccess("");
    setUpdatingPublic(true);

    try {
      const res = await fetch(`/api/projects/${projectId}/share-link`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: publicEnabled,
          role: publicRole,
          expiresIn: publicExpiry,
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error || "Failed to update link sharing");
        return;
      }

      setSuccess(
        publicEnabled
          ? "Anyone-share settings updated"
          : "Anyone-share disabled"
      );
      if (data.share?.url) {
        setPublicUrl(data.share.url);
      } else if (!publicEnabled) {
        setPublicUrl(null);
      }
      await fetchCollaborators();
      onChanged?.();
    } catch {
      setError("Failed to update link sharing");
    } finally {
      setUpdatingPublic(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-overlay animate-fade-in"
        onClick={onClose}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-dialog-title"
        className="animate-slide-up relative z-10 flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-bg-secondary shadow-xl"
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border-subtle px-6 py-4">
          <div className="flex items-center gap-2.5">
            <Users className="h-4 w-4 shrink-0 text-text-muted" aria-hidden />
            <div>
              <h2
                id="share-dialog-title"
                className="text-sm font-semibold text-text-primary"
              >
                Share project
              </h2>
              <p className="mt-0.5 truncate text-xs text-text-muted">
                {projectName}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 rounded-md p-1 text-text-muted transition-colors duration-150 ease-out hover:bg-bg-elevated hover:text-text-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">

        {isOwner && (
          <>
            <form onSubmit={handleInvite} className="mb-6">
              <p className="mb-2.5 font-mono text-[11px] font-medium uppercase tracking-wide text-text-muted">
                Invite by email
              </p>
              <div className="flex flex-wrap gap-2">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  aria-label="Collaborator email"
                  required
                  className="input min-w-[220px] flex-1"
                />
                <Select
                  value={role}
                  onValueChange={(value) => setRole(value as ShareRole)}
                >
                  <SelectTrigger className="w-[120px]">
                    <SelectValue placeholder="Role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="editor">Editor</SelectItem>
                    <SelectItem value="viewer">Viewer</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={inviteExpiry}
                  onValueChange={(value) => setInviteExpiry(value as ExpiryOption)}
                >
                  <SelectTrigger className="w-[130px]">
                    <SelectValue placeholder="Expiry" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="30m">30 min</SelectItem>
                    <SelectItem value="7d">7 days</SelectItem>
                    <SelectItem value="never">No expiry</SelectItem>
                  </SelectContent>
                </Select>
                <button
                  type="submit"
                  disabled={inviting || !email.trim()}
                  className="btn btn-primary py-2"
                >
                  {inviting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <UserPlus className="h-4 w-4" />
                  )}
                  <span>Share</span>
                </button>
              </div>
            </form>

            <div className="mb-6 rounded-lg border border-border-subtle bg-bg-inset p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <Globe className="h-4 w-4 text-text-muted" aria-hidden />
                    <p className="text-sm font-medium text-text-primary">
                      Public link
                    </p>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                        publicEnabled
                          ? "bg-warning-subtle text-warning"
                          : "bg-bg-elevated text-text-muted"
                      )}
                    >
                      {publicEnabled ? (
                        <>
                          <Globe className="h-2.5 w-2.5" aria-hidden />
                          On
                        </>
                      ) : (
                        "Off"
                      )}
                    </span>
                  </div>
                  <p className="mt-1.5 max-w-[52ch] text-xs leading-relaxed text-text-muted">
                    Anyone holding the link opens the project without signing
                    in. Turn it off to revoke every copy of the link at once.
                  </p>
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={publicEnabled}
                  aria-label="Toggle public link sharing"
                  onClick={() => setPublicEnabled((prev) => !prev)}
                  className={cn(
                    "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-150 ease-out",
                    publicEnabled
                      ? "border-accent bg-accent"
                      : "border-border bg-bg-elevated hover:border-border-strong"
                  )}
                >
                  <span
                    className={cn(
                      "inline-block h-4 w-4 rounded-full transition-transform duration-150 ease-out",
                      publicEnabled
                        ? "translate-x-[22px] bg-accent-fg"
                        : "translate-x-[3px] bg-text-muted"
                    )}
                  />
                </button>
              </div>

              {publicEnabled && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Select
                    value={publicRole}
                    onValueChange={(value) => setPublicRole(value as ShareRole)}
                  >
                    <SelectTrigger className="w-[120px]">
                      <SelectValue placeholder="Role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="viewer">Viewer</SelectItem>
                      <SelectItem value="editor">Editor</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select
                    value={publicExpiry}
                    onValueChange={(value) => setPublicExpiry(value as ExpiryOption)}
                  >
                    <SelectTrigger className="w-[130px]">
                      <SelectValue placeholder="Expiry" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="30m">30 min</SelectItem>
                      <SelectItem value="7d">7 days</SelectItem>
                      <SelectItem value="never">No expiry</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handlePublicShareSave}
                  disabled={updatingPublic}
                  className="btn btn-secondary py-2"
                >
                  {updatingPublic ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Clock3 className="h-4 w-4" />
                  )}
                  Update public link
                </button>

                {publicEnabled && publicUrl && (
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(publicUrl);
                        setCopiedPublicUrl(true);
                        setSuccess("Public link copied");
                        setTimeout(() => setCopiedPublicUrl(false), 1500);
                      } catch {
                        setError("Could not copy link");
                      }
                    }}
                    className="btn btn-secondary py-2"
                  >
                    {copiedPublicUrl ? (
                      <Check className="h-4 w-4 text-success" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                    {copiedPublicUrl ? "Copied" : "Copy link"}
                  </button>
                )}
              </div>

              {publicEnabled && publicUrl && (
                <div className="mt-3 rounded-md border border-border bg-bg-secondary p-2.5">
                  <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wide text-text-muted">
                    Public URL
                  </p>
                  <div className="flex items-center gap-2">
                    <Link2 className="h-3.5 w-3.5 shrink-0 text-text-muted" aria-hidden />
                    <input
                      type="text"
                      value={publicUrl}
                      readOnly
                      aria-label="Public project URL"
                      onFocus={(e) => e.currentTarget.select()}
                      className="min-w-0 flex-1 select-all bg-transparent font-mono text-xs text-text-secondary outline-none"
                    />
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {error && (
          <p
            role="alert"
            className="mb-3 flex items-start gap-2 rounded-md bg-error-subtle px-2.5 py-2 text-xs text-error"
          >
            <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>{error}</span>
          </p>
        )}
        {success && (
          <p
            role="status"
            className="mb-3 flex items-start gap-2 rounded-md bg-success-subtle px-2.5 py-2 text-xs text-success"
          >
            <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>{success}</span>
          </p>
        )}

        <p className="mb-2.5 font-mono text-[11px] font-medium uppercase tracking-wide text-text-muted">
          People with access
        </p>

        <div className="space-y-0.5">
          {owner && (
            <div className="flex items-center gap-3 rounded-lg px-3 py-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-subtle text-sm font-semibold text-accent">
                {owner.name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-text-primary">{owner.name}</p>
                <p className="truncate text-xs text-text-muted">{owner.email}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-text-secondary">
                <Crown className="h-3.5 w-3.5 text-warning" aria-hidden />
                Owner
              </div>
            </div>
          )}

          {loading && collaborators.length === 0 && (
            <div aria-busy className="space-y-0.5">
              {[0, 1].map((row) => (
                <div key={row} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="animate-pulse-soft h-8 w-8 shrink-0 rounded-full bg-bg-elevated" />
                  <div className="flex-1 space-y-1.5">
                    <div className="animate-pulse-soft h-3 w-32 rounded bg-bg-elevated" />
                    <div className="animate-pulse-soft h-2.5 w-44 rounded bg-bg-elevated" />
                  </div>
                </div>
              ))}
              <span className="sr-only">Loading collaborators</span>
            </div>
          )}

          {collaborators.map((collab) => (
            <div
              key={collab.id}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors duration-150 ease-out hover:bg-bg-elevated"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-bg-elevated text-sm font-semibold text-text-secondary">
                {collab.name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-text-primary">{collab.name}</p>
                <p className="truncate text-xs text-text-muted">{collab.email}</p>
                <p className="mt-0.5 text-[11px] text-text-muted" data-numeric>
                  {formatExpiry(collab.expiresAt)}
                </p>
              </div>

              {isOwner ? (
                <div className="flex items-center gap-1.5">
                  <Select
                    value={collab.role}
                    onValueChange={(value) =>
                      handleRoleChange(collab.id, value as ShareRole)
                    }
                  >
                    <SelectTrigger className="h-8 w-[105px] rounded-md px-2 py-1 text-xs">
                      <SelectValue placeholder="Role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="editor">Editor</SelectItem>
                      <SelectItem value="viewer">Viewer</SelectItem>
                    </SelectContent>
                  </Select>
                  <button
                    type="button"
                    onClick={() => handleRemove(collab.id)}
                    className="rounded-md p-1.5 text-text-muted transition-colors duration-150 ease-out hover:bg-error-subtle hover:text-error"
                    title="Remove collaborator"
                    aria-label={`Remove ${collab.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs text-text-muted">
                  {collab.role === "editor" ? (
                    <>
                      <Pencil className="h-3 w-3" />
                      Editor
                    </>
                  ) : (
                    <>
                      <Eye className="h-3 w-3" />
                      Viewer
                    </>
                  )}
                </span>
              )}
            </div>
          ))}

          {!loading && collaborators.length === 0 && (
            <div className="px-3 py-6">
              <p className="text-sm text-text-secondary">
                No collaborators yet
              </p>
              <p className="mt-1 max-w-[56ch] text-xs leading-relaxed text-text-muted">
                {isOwner
                  ? "Invite someone by email to give them their own sign-in, an editor or viewer role, and an expiry you control. Use the public link only when you want anyone holding the URL to get in."
                  : "Only the project owner can invite people."}
              </p>
            </div>
          )}
        </div>
        </div>
      </div>
    </div>
  );
}
