"use client";

import { useState } from "react";
import { cn } from "@/lib/utils/cn";
import {
  Play,
  Loader2,
  Square,
  CheckCircle2,
  XCircle,
  ChevronDown,
  Check,
  Ban,
  Circle,
  Sparkles,
} from "lucide-react";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { AppHeader } from "@/components/AppHeader";
import { PresenceAvatars } from "@/components/editor/PresenceAvatars";
import type { PresenceUser } from "@myeditor/shared";

// ─── Types ──────────────────────────────────────────

interface ProjectListItem {
  id: string;
  name: string;
  lastBuildStatus: string | null;
}

interface EditorHeaderProps {
  projectName: string;
  projectId: string;
  documentPath: string | null;
  compiling: boolean;
  onCompile: () => void;
  autoCompileEnabled: boolean;
  onAutoCompileToggle: (enabled: boolean) => void;
  buildStatus: string;
  onCancelBuild?: () => void;
  presenceUsers?: PresenceUser[];
  currentUserId?: string;
  role?: "owner" | "viewer" | "editor";
  followingUserId?: string | null;
  onFollowUser?: (userId: string) => void;
  isSharedProject?: boolean;
  shareToken?: string | null;
  canEdit?: boolean;
  aiPanelOpen?: boolean;
  onToggleAiPanel?: () => void;
}

// ─── Build status ──────────────────────────────────

// Status is the loudest thing in this row: it is what the user glances at
// between edits. Icon + label always, tint second, never colour alone.
const BUILD_STATES: Record<
  string,
  { label: string; Icon: typeof Circle; tone: string; spin?: boolean }
> = {
  success: {
    label: "Built",
    Icon: CheckCircle2,
    tone: "bg-success-subtle text-success",
  },
  error: { label: "Failed", Icon: XCircle, tone: "bg-error-subtle text-error" },
  timeout: {
    label: "Timed out",
    Icon: XCircle,
    tone: "bg-error-subtle text-error",
  },
  compiling: {
    label: "Compiling",
    Icon: Loader2,
    tone: "bg-warning-subtle text-warning",
    spin: true,
  },
  queued: {
    label: "Queued",
    Icon: Loader2,
    tone: "bg-warning-subtle text-warning",
    spin: true,
  },
  canceled: {
    label: "Canceled",
    Icon: Ban,
    tone: "bg-bg-elevated text-text-muted",
  },
};

const IDLE_STATE = {
  label: "Not built",
  Icon: Circle,
  tone: "bg-bg-inset text-text-muted",
  spin: false,
};

function BuildStatusBadge({ status }: { status: string }) {
  // Unknown states (offline, anything the server adds later) still get a
  // label rather than disappearing from the row.
  const state =
    BUILD_STATES[status] ??
    (status && status !== "idle"
      ? { ...IDLE_STATE, label: status.charAt(0).toUpperCase() + status.slice(1) }
      : IDLE_STATE);
  const { label, Icon, tone, spin } = state;

  return (
    <div
      aria-live="polite"
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2",
        "text-xs font-medium transition-colors duration-200 ease-out",
        tone
      )}
    >
      <Icon className={cn("h-3.5 w-3.5 shrink-0", spin && "animate-spin")} />
      <span className="hidden sm:inline">{label}</span>
      <span className="sr-only sm:hidden">{label}</span>
    </div>
  );
}

// ─── Small build status dot for dropdown items ─────

function BuildStatusDot({ status }: { status: string | null }) {
  if (!status) return null;
  const color =
    status === "success"
      ? "bg-success"
      : status === "error" || status === "timeout"
        ? "bg-error"
        : "bg-text-muted";
  return (
    <span
      title={status}
      className={cn("inline-block h-2 w-2 shrink-0 rounded-full", color)}
    />
  );
}

// ─── EditorHeader ──────────────────────────────────

export function EditorHeader({
  projectName,
  projectId,
  documentPath,
  compiling,
  onCompile,
  autoCompileEnabled,
  onAutoCompileToggle,
  buildStatus,
  onCancelBuild,
  presenceUsers = [],
  currentUserId = "",
  role = "owner",
  followingUserId,
  onFollowUser,
  isSharedProject = false,
  shareToken = null,
  canEdit = true,
  aiPanelOpen = false,
  onToggleAiPanel,
}: EditorHeaderProps) {
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [sharedProjects, setSharedProjects] = useState<ProjectListItem[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);

  const hasOtherUsers = presenceUsers.some((u) => u.userId !== currentUserId);

  async function fetchProjects() {
    setLoadingProjects(true);
    try {
      const res = await fetch("/api/projects", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setProjects(data.projects ?? []);
        setSharedProjects(data.sharedProjects ?? []);
      }
    } catch {
      // Silently fail
    }
    setLoadingProjects(false);
  }

  const projectSwitcher = shareToken ? (
    <>
      <div className="h-4 w-px shrink-0 bg-border-subtle" />
      <span className="max-w-[220px] truncate text-sm font-medium text-text-primary">
        {projectName}
      </span>
    </>
  ) : (
    <>
      <div className="h-4 w-px shrink-0 bg-border-subtle" />
      <DropdownMenu
        onOpenChange={(open) => {
          if (open) fetchProjects();
        }}
      >
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-1 text-sm font-medium text-text-primary truncate max-w-[200px] hover:text-accent transition-colors"
          >
            <span className="truncate">{projectName}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          {loadingProjects ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-text-muted" />
            </div>
          ) : (
            <>
              <DropdownMenuLabel>My Projects</DropdownMenuLabel>
              {projects.length === 0 && (
                <div className="px-2 py-1.5 text-xs text-text-muted">
                  No projects
                </div>
              )}
              {projects.map((p) => (
                <DropdownMenuItem
                  key={p.id}
                  onClick={() => {
                    if (p.id !== projectId) {
                      window.location.href = `/editor/${p.id}`;
                    }
                  }}
                  className="flex items-center gap-2"
                >
                  <BuildStatusDot status={p.lastBuildStatus} />
                  <span className="truncate flex-1">{p.name}</span>
                  {p.id === projectId && (
                    <Check className="h-3.5 w-3.5 text-accent shrink-0" />
                  )}
                </DropdownMenuItem>
              ))}
              {sharedProjects.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Shared with me</DropdownMenuLabel>
                  {sharedProjects.map((p) => (
                    <DropdownMenuItem
                      key={p.id}
                      onClick={() => {
                        if (p.id !== projectId) {
                          window.location.href = `/editor/${p.id}`;
                        }
                      }}
                      className="flex items-center gap-2"
                    >
                      <BuildStatusDot status={p.lastBuildStatus} />
                      <span className="truncate flex-1">{p.name}</span>
                      {p.id === projectId && (
                        <Check className="h-3.5 w-3.5 text-accent shrink-0" />
                      )}
                    </DropdownMenuItem>
                  ))}
                </>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );

  return (
    <AppHeader leftContent={projectSwitcher}>
      {/* Compilation progress bar */}
      {(buildStatus === "compiling" || buildStatus === "queued") && (
        <div className="absolute top-0 right-0 left-0 overflow-hidden">
          <div className="compilation-progress w-full" />
        </div>
      )}

      <TooltipProvider delayDuration={300}>
        {/* Build cluster: run it, stop it, automate it. One group. */}
        {canEdit && (
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onCompile}
                  disabled={compiling || !documentPath}
                  className="btn btn-primary h-7 px-2.5 text-xs"
                >
                  {compiling ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Play className="h-3.5 w-3.5" />
                  )}
                  <span className="hidden sm:inline">
                    {compiling ? "Compiling" : "Compile"}
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <p>
                  {documentPath
                    ? `Compile ${documentPath} (Ctrl+Enter)`
                    : "Select or create a document first"}
                </p>
              </TooltipContent>
            </Tooltip>

            {(buildStatus === "compiling" || buildStatus === "queued") &&
              onCancelBuild && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={onCancelBuild}
                      className="btn btn-secondary h-7 px-2.5 text-xs"
                    >
                      <Square className="h-3 w-3" />
                      <span className="hidden sm:inline">Cancel</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Cancel build</p>
                  </TooltipContent>
                </Tooltip>
              )}

            {/* Auto-compile: a labelled switch, not a mystery pill */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  role="switch"
                  aria-checked={autoCompileEnabled}
                  aria-label="Toggle auto-compile"
                  onClick={() => onAutoCompileToggle(!autoCompileEnabled)}
                  className={cn(
                    "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border",
                    "px-2 text-xs font-medium transition-colors duration-150 ease-out",
                    autoCompileEnabled
                      ? "border-accent-muted bg-accent-subtle text-text-primary"
                      : "border-border bg-bg-inset text-text-muted hover:border-border-strong hover:text-text-secondary"
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "relative h-3 w-5 rounded-full transition-colors duration-150 ease-out",
                      autoCompileEnabled ? "bg-accent" : "bg-border-strong"
                    )}
                  >
                    <span
                      className={cn(
                        "absolute top-0.5 left-0.5 h-2 w-2 rounded-full bg-bg-secondary",
                        "transition-transform duration-150 ease-out",
                        autoCompileEnabled && "translate-x-2"
                      )}
                    />
                  </span>
                  <span className="hidden md:inline">Auto</span>
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Auto-compile {autoCompileEnabled ? "on" : "off"}</p>
              </TooltipContent>
            </Tooltip>
          </div>
        )}

        <BuildStatusBadge status={buildStatus} />

        {onToggleAiPanel && (
          <>
            <div className="mx-0.5 h-4 w-px shrink-0 bg-border-subtle" />
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onToggleAiPanel}
                  aria-pressed={aiPanelOpen}
                  className={cn(
                    "btn h-7 border px-2.5 text-xs",
                    aiPanelOpen
                      ? "border-accent-muted bg-accent-subtle text-accent"
                      : "border-border bg-bg-inset text-text-secondary hover:border-border-strong hover:text-text-primary"
                  )}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">AI</span>
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <p>
                  {aiPanelOpen ? "Hide AI assistant" : "Ask AI about this document"}
                </p>
              </TooltipContent>
            </Tooltip>
          </>
        )}
      </TooltipProvider>

      {/* Access context, then who else is in the room */}
      {(role !== "owner" || isSharedProject || hasOtherUsers) && (
        <>
          <div className="mx-0.5 h-4 w-px shrink-0 bg-border-subtle" />
          <div className="flex shrink-0 items-center gap-1.5">
            {role !== "owner" && (
              <span className="inline-flex shrink-0 items-center rounded-full border border-border bg-bg-elevated px-2 py-0.5 text-[10px] font-medium text-text-secondary">
                {role === "editor" ? "Editor" : "Viewer"}
              </span>
            )}

            {isSharedProject && (
              <span className="inline-flex shrink-0 items-center rounded-full border border-accent-muted bg-accent-subtle px-2 py-0.5 text-[10px] font-medium text-accent">
                Shared
              </span>
            )}

            <PresenceAvatars
              users={presenceUsers}
              currentUserId={currentUserId}
              followingUserId={followingUserId}
              onFollowUser={onFollowUser}
            />
          </div>
        </>
      )}
    </AppHeader>
  );
}
