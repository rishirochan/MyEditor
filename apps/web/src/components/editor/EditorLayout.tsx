"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import dynamic from "next/dynamic";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  ImperativePanelHandle,
} from "react-resizable-panels";
import { EditorHeader } from "@/components/editor/EditorHeader";
import { ProjectActions } from "@/components/editor/ProjectActions";
import { FileTree } from "@/components/editor/FileTree";
import { CodeEditor, CodeEditorHandle } from "@/components/editor/CodeEditor";
import { EditorTabs } from "@/components/editor/EditorTabs";
import type { PdfViewerHandle } from "@/components/editor/PdfViewer";
import { BuildLogs } from "@/components/editor/BuildLogs";
import { ChatPanel } from "@/components/editor/ChatPanel";
import { AiChatPanel } from "@/components/editor/AiChatPanel";
import { useWebSocket } from "@/hooks/useWebSocket";
import { cn } from "@/lib/utils/cn";
import { FileText } from "lucide-react";
import type { PresenceUser, ChatMessage, CursorSelection, DocChange } from "@myeditor/shared";

const PdfViewer = dynamic(
  () =>
    import("@/components/editor/PdfViewer").then((module) => module.PdfViewer),
  { ssr: false }
);

// ─── Types ──────────────────────────────────────────

interface ProjectFile {
  id: string;
  projectId: string;
  path: string;
  mimeType: string | null;
  sizeBytes: number | null;
  isDirectory: boolean | null;
  isDocument: boolean;
  createdAt: string;
  updatedAt: string;
}

interface Build {
  id: string;
  projectId: string;
  userId: string;
  status: string;
  engine: string;
  mainFile: string;
  logs: string | null;
  durationMs: number | null;
  pdfPath: string | null;
  exitCode: number | null;
  createdAt: string;
  completedAt: string | null;
}

interface Project {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  engine: string;
  mainFile: string;
  createdAt: string;
  updatedAt: string;
}

interface OpenFile {
  id: string;
  path: string;
}

interface LogError {
  type: string;
  file: string;
  line: number;
  message: string;
}

interface CurrentUser {
  id: string;
  email: string;
  name: string;
}

interface ChatReadReceipt {
  userId: string;
  lastReadMessageId: string;
  timestamp: number;
}

interface CollaboratorInfo {
  id: string;
  userId: string;
  email: string;
  name: string;
  role: "viewer" | "editor";
  createdAt: string;
  expiresAt?: string | null;
}

interface PublicShareInfo {
  enabled: boolean;
  role: "viewer" | "editor";
  expiresAt: string | null;
  token?: string | null;
  url?: string | null;
}

interface SelectFileOptions {
  preserveFollow?: boolean;
}

interface EditorLayoutProps {
  project: Project;
  files: ProjectFile[];
  lastBuild: Build | null;
  role?: "owner" | "viewer" | "editor";
  currentUser?: CurrentUser;
  shareToken?: string | null;
  isPublicShare?: boolean;
  onIdentityResolved?: (user: CurrentUser) => void;
}

// ─── Chrome ─────────────────────────────────────────

// Resize handles are a hairline at rest and only announce themselves under
// the pointer: the seam thickens and picks up the accent. Colour transitions,
// the width step is instant so nothing animates layout.
const RESIZE_HANDLE_COL =
  "relative w-1.5 shrink-0 cursor-col-resize touch-none bg-transparent " +
  "after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 " +
  "after:bg-border after:transition-colors after:duration-150 after:ease-out " +
  "hover:after:w-[3px] hover:after:bg-accent " +
  "data-[resize-handle-active]:after:w-[3px] data-[resize-handle-active]:after:bg-accent";

const RESIZE_HANDLE_ROW =
  "relative h-1.5 shrink-0 cursor-row-resize touch-none bg-transparent " +
  "after:absolute after:inset-x-0 after:top-1/2 after:h-px after:-translate-y-1/2 " +
  "after:bg-border after:transition-colors after:duration-150 after:ease-out " +
  "hover:after:h-[3px] hover:after:bg-accent " +
  "data-[resize-handle-active]:after:h-[3px] data-[resize-handle-active]:after:bg-accent";

// ─── Editor Layout ──────────────────────────────────

export function EditorLayout({
  project,
  files: initialFiles,
  lastBuild: initialBuild,
  role = "owner",
  currentUser: initialCurrentUser = { id: "", email: "", name: "" },
  shareToken = null,
  isPublicShare = false,
  onIdentityResolved,
}: EditorLayoutProps) {
  // Viewers can only see live changes and PDF — no editing, no builds
  const canEdit = role === "owner" || role === "editor";

  const [currentUser, setCurrentUser] = useState<CurrentUser>(initialCurrentUser);
  const [files, setFiles] = useState<ProjectFile[]>(initialFiles);
  const initialDocument =
    initialFiles.find((file) => file.isDocument && file.path === project.mainFile) ??
    initialFiles.find((file) => file.isDocument) ??
    null;
  const [activeDocumentId, setActiveDocumentId] = useState<string | null>(
    initialDocument?.id ?? null
  );
  const mainFilePath =
    files.find((file) => file.id === activeDocumentId)?.path ?? null;
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [activeFileContent, setActiveFileContent] = useState<string>("");
  const [tabsRestored, setTabsRestored] = useState(false);
  // Normalize stale in-progress build statuses: if DB says queued/compiling,
  // the build may have finished or crashed while nobody was watching.
  const initialBuildStatus = (() => {
    const s = initialBuild?.status;
    if (s === "queued" || s === "compiling") return "idle";
    return s ?? "idle";
  })();
  const [compiling, setCompiling] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(
    initialBuild?.status === "success"
      ? shareToken
        ? `/api/projects/${project.id}/pdf?mainFile=${encodeURIComponent(
            project.mainFile
          )}&t=${Date.now()}&share=${encodeURIComponent(
            shareToken
          )}`
        : `/api/projects/${project.id}/pdf?mainFile=${encodeURIComponent(
            project.mainFile
          )}&t=${Date.now()}`
      : null
  );
  const [buildStatus, setBuildStatus] = useState(initialBuildStatus);
  const [buildLogs, setBuildLogs] = useState(initialBuild?.logs ?? "");
  const [buildDuration, setBuildDuration] = useState<number | null>(
    initialBuild?.durationMs ?? null
  );
  const [buildActorName, setBuildActorName] = useState<string | null>(null);
  const [buildErrors, setBuildErrors] = useState<LogError[]>([]);
  const [aiFixExplanation, setAiFixExplanation] = useState<string | null>(null);
  const [fixingWithAi, setFixingWithAi] = useState(false);
  const [buildLogsExpanded, setBuildLogsExpanded] = useState(true);
  const [pdfLoading, setPdfLoading] = useState(false);

  // Disable auto-compile if last build failed (prevents rebuild loop on refresh)
  const [autoCompileEnabled, setAutoCompileEnabled] = useState(() => {
    if (initialBuild?.status === "error" || initialBuild?.status === "timeout") {
      return false;
    }
    return true;
  });

  const [dirtyFileIds, setDirtyFileIds] = useState<Set<string>>(new Set());

  // ─── AI Chat Panel State ──────────────────────────

  const canUseAi = canEdit && !shareToken;
  const [aiTabActive, setAiTabActive] = useState(false);
  const [aiPendingSelection, setAiPendingSelection] = useState<{
    fromLine: number;
    toLine: number;
    text: string;
  } | null>(null);

  // ─── Compile Guards (prevent build pileup) ────────

  // Ref-based compiling flag: avoids stale closures in callbacks
  const compilingRef = useRef(false);
  // Build currently owned by this editor session — ignore WS/poll events for others.
  // "pending" means we started a compile but don't have the server buildId yet.
  const currentBuildIdRef = useRef<string | null>(null);
  const currentBuildMainFileRef = useRef<string | null>(null);
  // When a save+compile is requested while already compiling, set this flag.
  // After the current build completes successfully, we'll trigger a recompile.
  const pendingRecompileRef = useRef(false);
  // Track autoCompileEnabled via ref for use in WS callbacks
  const autoCompileEnabledRef = useRef(autoCompileEnabled);
  autoCompileEnabledRef.current = autoCompileEnabled;

  // ─── Collaboration State ──────────────────────────

  const [presenceUsers, setPresenceUsers] = useState<PresenceUser[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatReadState, setChatReadState] = useState<
    Map<string, { lastReadMessageId: string; timestamp: number }>
  >(new Map());
  const [isSharedProject, setIsSharedProject] = useState(role !== "owner");
  const [shareHistoryEntries, setShareHistoryEntries] = useState<string[]>([]);

  const [remoteChanges, setRemoteChanges] = useState<{
    fileId: string;
    userId: string;
    changes: DocChange[];
  } | null>(null);

  const [remoteCursors, setRemoteCursors] = useState<
    Map<string, { color: string; name: string; selection: CursorSelection }>
  >(new Map());

  // ─── Follow Mode State ──────────────────────────

  const [followingUserId, setFollowingUserId] = useState<string | null>(null);
  const followingUserIdRef = useRef<string | null>(null);
  followingUserIdRef.current = followingUserId;

  // User color map for chat
  const userColorMap = new Map<string, string>();
  presenceUsers.forEach((u) => userColorMap.set(u.userId, u.color));
  const userNameMap = new Map<string, string>();
  presenceUsers.forEach((u) => userNameMap.set(u.userId, u.name));
  chatMessages.forEach((m) => {
    if (!userNameMap.has(m.userId)) {
      userNameMap.set(m.userId, m.userName);
    }
  });
  if (currentUser.id) {
    userNameMap.set(currentUser.id, currentUser.name || "You");
  }

  const codeEditorRef = useRef<CodeEditorHandle>(null);
  const pdfViewerRef = useRef<PdfViewerHandle>(null);
  const buildLogsPanelRef = useRef<ImperativePanelHandle>(null);
  const savedContentRef = useRef<Map<string, string>>(new Map());
  const fileContentsRef = useRef<Map<string, string>>(new Map());
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoOpenedMainRef = useRef(false);
  const restoredTabStateRef = useRef(false);
  const restoredTabsProjectRef = useRef<string | null>(null);
  const fileLoadRetriesRef = useRef<Map<string, number>>(new Map());
  const filesRef = useRef(initialFiles);
  filesRef.current = files;

  const activeFileIdRef = useRef<string | null>(null);
  activeFileIdRef.current = activeFileId;
  const activeDocumentIdRef = useRef<string | null>(activeDocumentId);
  activeDocumentIdRef.current = activeDocumentId;
  const activeDocumentPathRef = useRef<string | null>(mainFilePath);
  activeDocumentPathRef.current = mainFilePath;

  const withShareToken = useCallback(
    (url: string) => {
      if (!shareToken) return url;
      const separator = url.includes("?") ? "&" : "?";
      return `${url}${separator}share=${encodeURIComponent(shareToken)}`;
    },
    [shareToken]
  );

  const saveViewPositionsBeforeBuild = useCallback(() => {
    pdfViewerRef.current?.saveScrollPosition();
  }, []);

  const restoreViewPositionsAfterBuild = useCallback(() => {
    // PDF viewer handles its own restore on reload; the editor must NOT be
    // touched here because the user keeps typing during auto-compile and
    // forcing the cursor back to its pre-build position causes #31.
  }, []);

  const formatExpiry = useCallback((expiresAt: string | null | undefined) => {
    if (!expiresAt) return "no expiry";
    const when = new Date(expiresAt);
    return `expires ${when.toLocaleString()}`;
  }, []);

  const refreshShareState = useCallback(async () => {
    if (shareToken) {
      setIsSharedProject(true);
      setShareHistoryEntries([]);
      return;
    }

    try {
      const [collabRes, publicRes] = await Promise.all([
        fetch(`/api/projects/${project.id}/collaborators`, { cache: "no-store" }),
        fetch(`/api/projects/${project.id}/share-link`, { cache: "no-store" }),
      ]);

      const collaborators: CollaboratorInfo[] = collabRes.ok
        ? (await collabRes.json()).collaborators ?? []
        : [];

      const publicShare: PublicShareInfo = publicRes.ok
        ? (await publicRes.json()).share ?? {
            enabled: false,
            role: "viewer",
            expiresAt: null,
          }
        : { enabled: false, role: "viewer", expiresAt: null };

      const historyEntries: string[] = [];

      if (publicShare.enabled) {
        historyEntries.push(
          `Shared with anyone (${publicShare.role}, ${formatExpiry(
            publicShare.expiresAt
          )})`
        );
      }

      collaborators
        .slice()
        .sort(
          (a, b) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        )
        .forEach((collab) => {
          historyEntries.push(
            `Shared with ${collab.email} (${collab.role}, ${formatExpiry(
              collab.expiresAt
            )})`
          );
        });

      setShareHistoryEntries(historyEntries);
      setIsSharedProject(
        role !== "owner" || publicShare.enabled || collaborators.length > 0
      );
    } catch {
      setShareHistoryEntries([]);
      setIsSharedProject(role !== "owner");
    }
  }, [formatExpiry, project.id, role, shareToken]);

  const resolveActorName = useCallback(
    (triggeredByUserId?: string | null): string | null => {
      if (!triggeredByUserId) return null;
      if (triggeredByUserId === currentUser.id) return "You";
      return (
        presenceUsers.find((u) => u.userId === triggeredByUserId)?.name ??
        null
      );
    },
    [currentUser.id, presenceUsers]
  );

  // ─── Helpers ───────────────────────────────────────

  const clearAllPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
  }, []);

  /** Reset all compiling state back to idle */
  const resetCompileState = useCallback(() => {
    compilingRef.current = false;
    currentBuildIdRef.current = null;
    currentBuildMainFileRef.current = null;
    pendingRecompileRef.current = false;
    setCompiling(false);
    setPdfLoading(false);
    clearAllPolling();
  }, [clearAllPolling]);

  const isCurrentBuild = useCallback((buildId: string | null | undefined) => {
    const current = currentBuildIdRef.current;
    if (!current) return true;
    // Still waiting for our buildId — don't accept completes for a prior build
    if (current === "pending") return false;
    if (!buildId) return false;
    return current === buildId;
  }, []);

  const beginCompileTracking = useCallback((buildId?: string | null) => {
    currentBuildIdRef.current =
      typeof buildId === "string" && buildId.length > 0 ? buildId : "pending";
    currentBuildMainFileRef.current = activeDocumentPathRef.current;
  }, []);

  const adoptBuildIdIfPending = useCallback((buildId: string | null | undefined) => {
    if (
      currentBuildIdRef.current === "pending" &&
      typeof buildId === "string" &&
      buildId.length > 0
    ) {
      currentBuildIdRef.current = buildId;
    }
  }, []);

  const applyChangesToCache = useCallback(
    (fileId: string, changes: DocChange[]) => {
      const cached = fileContentsRef.current.get(fileId);
      if (cached === undefined) return;

      let result = cached;
      const sorted = [...changes].sort((a, b) => b.from - a.from);
      for (const change of sorted) {
        const from = Math.min(change.from, result.length);
        const to = Math.min(change.to, result.length);
        result = result.slice(0, from) + change.insert + result.slice(to);
      }
      fileContentsRef.current.set(fileId, result);
    },
    []
  );

  const fetchFileContent = useCallback(
    async (fileId: string) => {
      try {
        const res = await fetch(
          withShareToken(`/api/projects/${project.id}/files/${fileId}`),
          { cache: "no-store" }
        );
        if (res.ok) {
          const data = await res.json();
          const content = data.content ?? "";
          fileContentsRef.current.set(fileId, content);
          fileLoadRetriesRef.current.delete(fileId);
          if (activeFileIdRef.current === fileId) {
            setActiveFileContent(content);
          }
          savedContentRef.current.set(fileId, content);
          setDirtyFileIds((prev) => {
            const next = new Set(prev);
            next.delete(fileId);
            return next;
          });
        } else {
          const retries = fileLoadRetriesRef.current.get(fileId) ?? 0;
          if (retries < 2) {
            fileLoadRetriesRef.current.set(fileId, retries + 1);
            setTimeout(() => {
              if (activeFileIdRef.current === fileId) {
                fetchFileContent(fileId);
              }
            }, 300);
          }
        }
      } catch {
        const retries = fileLoadRetriesRef.current.get(fileId) ?? 0;
        if (retries < 2) {
          fileLoadRetriesRef.current.set(fileId, retries + 1);
          setTimeout(() => {
            if (activeFileIdRef.current === fileId) {
              fetchFileContent(fileId);
            }
          }, 300);
          return;
        }
        if (activeFileIdRef.current === fileId) {
          setActiveFileContent("");
        }
      }
    },
    [project.id, withShareToken]
  );

  // ─── Polling fallback for build completion ────────

  const startBuildPolling = useCallback(() => {
    clearAllPolling();
    const mainFile = currentBuildMainFileRef.current;
    if (!mainFile) return;

    pollIntervalRef.current = setInterval(async () => {
      try {
        const searchParams = new URLSearchParams({ mainFile });
        const buildId = currentBuildIdRef.current;
        if (buildId && buildId !== "pending") {
          searchParams.set("buildId", buildId);
        }
        const logsRes = await fetch(
          withShareToken(
            `/api/projects/${project.id}/logs?${searchParams}`
          ),
          { cache: "no-store" }
        );
        if (!logsRes.ok) return;

        const logsData = await logsRes.json();
        const build = logsData.build;

        if (currentBuildIdRef.current === "pending") {
          if (build?.status === "queued" || build?.status === "compiling") {
            adoptBuildIdIfPending(build.id);
          } else {
            return;
          }
        } else if (!isCurrentBuild(build?.id)) {
          return;
        }

        if (
          build.status === "success" ||
          build.status === "error" ||
          build.status === "timeout" ||
          build.status === "canceled"
        ) {
          clearAllPolling();

          // Only update if still compiling (WS may have handled it)
          if (!compilingRef.current) return;

          setBuildStatus(build.status);
          setBuildLogs(build.logs ?? "");
          setBuildDuration(build.durationMs);
          setBuildErrors(logsData.errors ?? []);

          if (build.status === "success") {
            setPdfUrl(
              withShareToken(
                `/api/projects/${project.id}/pdf?mainFile=${encodeURIComponent(
                  mainFile
                )}&t=${Date.now()}`
              )
            );
            restoreViewPositionsAfterBuild();

            // If file was changed during build, recompile
            if (pendingRecompileRef.current) {
              pendingRecompileRef.current = false;
              setBuildStatus("queued");
              beginCompileTracking();
              saveViewPositionsBeforeBuild();
              fetch(withShareToken(`/api/projects/${project.id}/compile`), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ mainFile }),
              })
                .then(async (res) => {
                  if (res.ok) {
                    const data = await res.json().catch(() => ({}));
                    if (typeof data.buildId === "string") {
                      currentBuildIdRef.current = data.buildId;
                    }
                    startBuildPolling();
                  } else {
                    resetCompileState();
                    setBuildStatus("error");
                  }
                })
                .catch(() => {
                  resetCompileState();
                  setBuildStatus("error");
                });
              return; // Keep compiling state — recompile in progress
            }
          }

          if (build.status === "error" || build.status === "timeout") {
            setAutoCompileEnabled(false);
            pendingRecompileRef.current = false;
            if (saveTimeoutRef.current) {
              clearTimeout(saveTimeoutRef.current);
              saveTimeoutRef.current = null;
            }
            navigateToFirstError(logsData.errors ?? []);
          }

          if (build.status === "canceled") {
            pendingRecompileRef.current = false;
            if (saveTimeoutRef.current) {
              clearTimeout(saveTimeoutRef.current);
              saveTimeoutRef.current = null;
            }
          }

          resetCompileState();
        }
      } catch {
        // Polling error — keep trying
      }
    }, 1500);

    // Hard timeout: if polling finds nothing after 120s, give up
    pollTimeoutRef.current = setTimeout(() => {
      clearAllPolling();
      if (compilingRef.current) {
        setBuildStatus("timeout");
        setAutoCompileEnabled(false);
        pendingRecompileRef.current = false;
        resetCompileState();
      }
    }, 120_000);
  // navigateToFirstError is defined later in this module.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    adoptBuildIdIfPending,
    beginCompileTracking,
    clearAllPolling,
    isCurrentBuild,
    project.id,
    resetCompileState,
    restoreViewPositionsAfterBuild,
    saveViewPositionsBeforeBuild,
    withShareToken,
  ]);

  // ─── Active document build ────────────────────────
  useEffect(() => {
    resetCompileState();
    setPdfUrl(null);
    setBuildStatus("idle");
    setBuildLogs("");
    setBuildDuration(null);
    setBuildErrors([]);
    if (!mainFilePath) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          withShareToken(
            `/api/projects/${project.id}/logs?mainFile=${encodeURIComponent(
              mainFilePath
            )}`
          ),
          { cache: "no-store" }
        );
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const build = data.build;

        if (cancelled) return;

        if (build.status === "queued" || build.status === "compiling") {
          currentBuildIdRef.current = build.id ?? null;
          currentBuildMainFileRef.current = mainFilePath;
          compilingRef.current = true;
          setCompiling(true);
          setBuildStatus(build.status);
          setPdfLoading(true);
          startBuildPolling();
        } else if (build.status === "success") {
          setBuildStatus("success");
          setBuildLogs(build.logs ?? "");
          setBuildDuration(build.durationMs);
          setBuildErrors(data.errors ?? []);
          setPdfUrl(
            withShareToken(
              `/api/projects/${project.id}/pdf?mainFile=${encodeURIComponent(
                mainFilePath
              )}&t=${Date.now()}`
            )
          );
        } else if (build.status === "error" || build.status === "timeout") {
          setBuildStatus(build.status);
          setBuildLogs(build.logs ?? "");
          setBuildDuration(build.durationMs);
          setBuildErrors(data.errors ?? []);
          setAutoCompileEnabled(false);
        } else if (build.status === "canceled") {
          setBuildStatus(build.status);
          setBuildLogs(build.logs ?? "");
          setBuildDuration(build.durationMs);
          setBuildErrors([]);
        }
      } catch {
        // Failed to check — stay at idle
      }
    })();

    return () => { cancelled = true; };
  }, [mainFilePath, project.id, resetCompileState, startBuildPolling, withShareToken]);

  // ─── WebSocket Integration ────────────────────────

  const {
    sendActiveFile,
    sendCursorMove,
    sendDocChange,
    sendChatMessage,
    sendChatRead,
  } = useWebSocket(project.id, {
    shareToken,
    onSelfIdentity: (identity) => {
      // Update currentUser with WS-assigned identity (for anonymous users)
      if (!currentUser.id || currentUser.id !== identity.userId) {
        const resolved = { id: identity.userId, email: identity.email, name: identity.name };
        setCurrentUser(resolved);
        onIdentityResolved?.(resolved);
      }
    },
    onBuildStatus: (data) => {
      if (data.mainFile !== activeDocumentPathRef.current) return;
      currentBuildMainFileRef.current = data.mainFile;
      if (currentBuildIdRef.current === "pending") {
        adoptBuildIdIfPending(data.buildId);
      } else if (compilingRef.current && !isCurrentBuild(data.buildId)) {
        return;
      } else {
        currentBuildIdRef.current = data.buildId;
      }
      setBuildStatus(data.status);
      setBuildActorName(resolveActorName(data.triggeredByUserId));
      if (!compilingRef.current) {
        compilingRef.current = true;
        setCompiling(true);
      }
      setPdfLoading(true);
    },
    onBuildComplete: (data) => {
      if (data.mainFile !== activeDocumentPathRef.current) return;
      if (currentBuildIdRef.current === "pending") return;
      if (!isCurrentBuild(data.buildId)) return;

      clearAllPolling();

      setBuildStatus(data.status);
      setBuildActorName(resolveActorName(data.triggeredByUserId));
      setBuildLogs(data.logs ?? "");
      setBuildDuration(data.durationMs);
      setBuildErrors((data.errors as LogError[]) ?? []);

      if (data.status === "success") {
        setPdfUrl(
          withShareToken(
            `/api/projects/${project.id}/pdf?mainFile=${encodeURIComponent(
              data.mainFile
            )}&t=${Date.now()}`
          )
        );
        restoreViewPositionsAfterBuild();

        // If file was changed during build, recompile with latest content
        if (pendingRecompileRef.current) {
          pendingRecompileRef.current = false;
          setBuildStatus("queued");
          setPdfLoading(true);
          beginCompileTracking();
          saveViewPositionsBeforeBuild();
          fetch(withShareToken(`/api/projects/${project.id}/compile`), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mainFile: data.mainFile }),
          })
            .then(async (res) => {
              if (res.ok) {
                const body = await res.json().catch(() => ({}));
                if (typeof body.buildId === "string") {
                  currentBuildIdRef.current = body.buildId;
                }
                startBuildPolling();
              } else {
                resetCompileState();
                setBuildStatus("error");
              }
            })
            .catch(() => {
              resetCompileState();
              setBuildStatus("error");
            });
          return; // Keep compiling state — recompile in progress
        }
      }

      if (data.status === "error" || data.status === "timeout") {
        setAutoCompileEnabled(false);
        pendingRecompileRef.current = false;
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current);
          saveTimeoutRef.current = null;
        }
        navigateToFirstError((data.errors as LogError[]) ?? []);
      }

      if (data.status === "canceled") {
        pendingRecompileRef.current = false;
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current);
          saveTimeoutRef.current = null;
        }
      }

      resetCompileState();
    },
    // Presence events
    onPresenceUsers: (users) => {
      setPresenceUsers(users);
    },
    onPresenceJoined: (user) => {
      setPresenceUsers((prev) => {
        if (prev.find((u) => u.userId === user.userId)) return prev;
        return [...prev, user];
      });
    },
    onPresenceLeft: (userId) => {
      setPresenceUsers((prev) => prev.filter((u) => u.userId !== userId));
      setRemoteCursors((prev) => {
        const next = new Map(prev);
        next.delete(userId);
        return next;
      });
      // Break follow mode if followed user disconnects
      if (followingUserIdRef.current === userId) {
        setFollowingUserId(null);
      }
    },
    onPresenceUpdated: (data) => {
      setPresenceUsers((prev) =>
        prev.map((u) =>
          u.userId === data.userId
            ? { ...u, activeFileId: data.activeFileId, activeFilePath: data.activeFilePath }
            : u
        )
      );
      // Follow mode: switch file if followed user changes file
      if (followingUserIdRef.current === data.userId && data.activeFileId) {
        const file = files.find((f) => f.id === data.activeFileId);
        if (file && data.activeFileId !== activeFileIdRef.current) {
          handleFileSelect(file.id, file.path, { preserveFollow: true });
        }
      }
    },
    // Chat events
    onChatMessage: (message) => {
      setChatMessages((prev) => [...prev, message]);
    },
    onChatHistory: (messages) => {
      setChatMessages(messages);
    },
    onChatRead: (receipt: ChatReadReceipt) => {
      setChatReadState((prev) => {
        const next = new Map(prev);
        next.set(receipt.userId, {
          lastReadMessageId: receipt.lastReadMessageId,
          timestamp: receipt.timestamp,
        });
        return next;
      });
    },
    onChatReadState: (reads: ChatReadReceipt[]) => {
      const next = new Map<string, { lastReadMessageId: string; timestamp: number }>();
      for (const read of reads) {
        next.set(read.userId, {
          lastReadMessageId: read.lastReadMessageId,
          timestamp: read.timestamp,
        });
      }
      setChatReadState(next);
    },
    // File events
    onFileCreated: () => {
      refreshFiles();
    },
    onFileDeleted: (data) => {
      refreshFiles();
      if (openFiles.some((f) => f.id === data.fileId)) {
        handleCloseTab(data.fileId);
      }
    },
    onFileSaved: (data) => {
      if (data.fileId !== activeFileIdRef.current) {
        fileContentsRef.current.delete(data.fileId);
      } else {
        fetchFileContent(data.fileId);
      }
    },
    // Collaborative editing
    onDocChanged: (data) => {
      const { userId, fileId, changes } = data;
      if (fileId === activeFileIdRef.current) {
        setRemoteChanges({ fileId, userId, changes });
      }
      applyChangesToCache(fileId, changes);
    },
    onCursorUpdated: (data) => {
      if (data.fileId === activeFileIdRef.current) {
        setRemoteCursors((prev) => {
          const next = new Map(prev);
          const user = presenceUsers.find((u) => u.userId === data.userId);
          next.set(data.userId, {
            color: user?.color || "#888",
            name: user?.name || "Unknown",
            selection: data.selection,
          });
          return next;
        });
      }
      // Follow mode: scroll to followed user's cursor
      if (followingUserIdRef.current === data.userId && data.fileId === activeFileIdRef.current) {
        codeEditorRef.current?.scrollToLine(data.selection.head.line);
      }
    },
    onCursorCleared: (userId) => {
      setRemoteCursors((prev) => {
        const next = new Map(prev);
        next.delete(userId);
        return next;
      });
    },
  });

  // ─── Editor tab persistence ───────────────────────

  useEffect(() => {
    if (restoredTabsProjectRef.current === project.id) return;
    restoredTabsProjectRef.current = project.id;
    restoredTabStateRef.current = false;

    try {
      const raw = window.localStorage.getItem(`editor-tabs:${project.id}`);
      if (raw) {
        const stored = JSON.parse(raw) as {
          openFileIds?: unknown;
          activeFileId?: unknown;
          activeDocumentId?: unknown;
          aiTabActive?: unknown;
        };
        if (
          !Array.isArray(stored.openFileIds) ||
          !stored.openFileIds.every((id) => typeof id === "string")
        ) {
          throw new Error("Invalid saved editor tabs");
        }

        const availableFiles = new Map(
          filesRef.current
            .filter((file) => !file.isDirectory)
            .map((file) => [file.id, file] as const)
        );
        const restoredFiles = stored.openFileIds.flatMap((id) => {
          const file = availableFiles.get(id);
          return file ? [{ id: file.id, path: file.path }] : [];
        });
        const restoredActiveId =
          typeof stored.activeFileId === "string" &&
          restoredFiles.some((file) => file.id === stored.activeFileId)
            ? stored.activeFileId
            : restoredFiles[restoredFiles.length - 1]?.id ?? null;
        const restoredDocument =
          typeof stored.activeDocumentId === "string"
            ? availableFiles.get(stored.activeDocumentId)
            : undefined;

        setOpenFiles(restoredFiles);
        activeFileIdRef.current = restoredActiveId;
        setActiveFileId(restoredActiveId);
        setAiTabActive(stored.aiTabActive === true);
        if (restoredDocument?.isDocument) {
          activeDocumentIdRef.current = restoredDocument.id;
          activeDocumentPathRef.current = restoredDocument.path;
          setActiveDocumentId(restoredDocument.id);
        }
        restoredTabStateRef.current = true;
      }
    } catch {
      // Ignore stale browser state and use the normal first-visit default.
    } finally {
      setTabsRestored(true);
    }
  }, [project.id]);

  useEffect(() => {
    if (!tabsRestored) return;
    try {
      window.localStorage.setItem(
        `editor-tabs:${project.id}`,
        JSON.stringify({
          openFileIds: openFiles.map((file) => file.id),
          activeFileId,
          activeDocumentId,
          aiTabActive,
        })
      );
    } catch {
      // Browser storage is optional; editing still works without it.
    }
  }, [
    activeDocumentId,
    activeFileId,
    aiTabActive,
    openFiles,
    project.id,
    tabsRestored,
  ]);

  // ─── File content loading ─────────────────────────

  useEffect(() => {
    if (!activeFileId) return;

    const cached = fileContentsRef.current.get(activeFileId);
    if (cached !== undefined) {
      setActiveFileContent(cached);
      return;
    }

    fetchFileContent(activeFileId);
  }, [activeFileId, fetchFileContent]);

  // ─── File operations ──────────────────────────────

  const handleFileSelect = useCallback(
    (
      fileId: string,
      filePath: string | null,
      options: SelectFileOptions = {}
    ) => {
      if (!options.preserveFollow && followingUserIdRef.current) {
        setFollowingUserId(null);
      }

      // Opening a file always brings the editor tab back to the front
      setAiTabActive(false);

      if (activeFileId && activeFileContent !== undefined) {
        fileContentsRef.current.set(activeFileId, activeFileContent);
      }

      const resolvedFilePath =
        filePath ?? filesRef.current.find((f) => f.id === fileId)?.path ?? null;
      const selectedFile = filesRef.current.find((file) => file.id === fileId);

      if (selectedFile?.isDocument && selectedFile.id !== activeDocumentIdRef.current) {
        resetCompileState();
        activeDocumentIdRef.current = selectedFile.id;
        activeDocumentPathRef.current = selectedFile.path;
        setActiveDocumentId(selectedFile.id);
        setPdfUrl(null);
        setBuildStatus("idle");
      }

      setRemoteCursors(new Map());
      activeFileIdRef.current = fileId;
      setActiveFileId(fileId);
      const cached = fileContentsRef.current.get(fileId);
      setActiveFileContent(cached ?? "");

      const alreadyOpen = openFiles.some((f) => f.id === fileId);
      if (!alreadyOpen && resolvedFilePath) {
        setOpenFiles((prev) => [...prev, { id: fileId, path: resolvedFilePath }]);
      }

      sendActiveFile(fileId, resolvedFilePath);
    },
    [activeFileContent, activeFileId, openFiles, resetCompileState, sendActiveFile]
  );

  const handleCloseTab = useCallback(
    (fileId: string) => {
      setOpenFiles((prev) => {
        const next = prev.filter((f) => f.id !== fileId);
        if (activeFileId === fileId) {
          const newActive = next.length > 0 ? next[next.length - 1] : null;
          setActiveFileId(newActive?.id ?? null);
          if (!newActive) setActiveFileContent("");
        }
        return next;
      });
      setDirtyFileIds((prev) => {
        const next = new Set(prev);
        next.delete(fileId);
        return next;
      });
      savedContentRef.current.delete(fileId);
      fileContentsRef.current.delete(fileId);
    },
    [activeFileId]
  );

  // ─── Save & Compile ───────────────────────────────

  const handleSave = useCallback(
    async (content: string, shouldCompile: boolean) => {
      if (!canEdit) return;
      if (!activeFileId) return;
      if (savedContentRef.current.get(activeFileId) === content) return;

      // Decide whether to actually trigger a compile
      const willCompile = Boolean(
        shouldCompile &&
          activeDocumentPathRef.current &&
          !compilingRef.current &&
          !fixingWithAi
      );

      if (willCompile) {
        saveViewPositionsBeforeBuild();
        beginCompileTracking();
        compilingRef.current = true;
        pendingRecompileRef.current = false;
        setBuildActorName("You");
        setCompiling(true);
        setBuildStatus("queued");
        setPdfLoading(true);
      }

      try {
        const response = await fetch(
          withShareToken(`/api/projects/${project.id}/files/${activeFileId}`),
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              content,
              autoCompile: willCompile,
              mainFile: activeDocumentPathRef.current ?? undefined,
            }),
          }
        );

        if (!response.ok) {
          if (willCompile) resetCompileState();
          return;
        }

        const result = await response.json().catch(() => ({}));
        if (willCompile && typeof result.buildId === "string") {
          currentBuildIdRef.current = result.buildId;
        }

        savedContentRef.current.set(activeFileId, content);
        setDirtyFileIds((prev) => {
          const next = new Set(prev);
          next.delete(activeFileId);
          return next;
        });

        if (willCompile) {
          startBuildPolling();
        } else if (
          shouldCompile &&
          activeDocumentPathRef.current &&
          compilingRef.current
        ) {
          // Wanted to compile but already compiling — recompile after current build
          pendingRecompileRef.current = true;
        }
      } catch {
        if (willCompile) resetCompileState();
      }
    },
    [
      activeFileId,
      beginCompileTracking,
      canEdit,
      project.id,
      resetCompileState,
      saveViewPositionsBeforeBuild,
      startBuildPolling,
      fixingWithAi,
      withShareToken,
    ]
  );

  const handleEditorChange = useCallback(
    (content: string) => {
      if (!canEdit) return;

      // Break follow mode on local edit
      if (followingUserIdRef.current) {
        setFollowingUserId(null);
      }

      setActiveFileContent(content);

      let hasUnsavedChanges = false;

      if (activeFileId) {
        fileContentsRef.current.set(activeFileId, content);

        const savedContent = savedContentRef.current.get(activeFileId);
        hasUnsavedChanges = savedContent !== content;
        if (hasUnsavedChanges) {
          setDirtyFileIds((prev) => {
            const next = new Set(prev);
            next.add(activeFileId);
            return next;
          });
        } else {
          setDirtyFileIds((prev) => {
            const next = new Set(prev);
            next.delete(activeFileId);
            return next;
          });
        }
      }

      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      if (!activeFileId || !hasUnsavedChanges) return;

      saveTimeoutRef.current = setTimeout(() => {
        handleSave(content, autoCompileEnabled);
      }, 1000);
    },
    [handleSave, activeFileId, autoCompileEnabled, canEdit]
  );

  const handleImmediateSave = useCallback(() => {
    if (!activeFileId) return;
    if (!dirtyFileIds.has(activeFileId)) return;
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    handleSave(activeFileContent, true);
  }, [activeFileId, activeFileContent, dirtyFileIds, handleSave]);

  const handleCompile = useCallback(async () => {
    if (!canEdit) return;
    if (fixingWithAi) return;
    if (compilingRef.current) return;
    const mainFile = activeDocumentPathRef.current;
    if (!mainFile) return;

    setAiFixExplanation(null);
    saveViewPositionsBeforeBuild();
    beginCompileTracking();
    compilingRef.current = true;
    pendingRecompileRef.current = false;
    setBuildActorName("You");
    setCompiling(true);
    setBuildStatus("compiling");
    setPdfLoading(true);

    try {
      const res = await fetch(withShareToken(`/api/projects/${project.id}/compile`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mainFile }),
      });

      if (!res.ok) {
        setBuildStatus("error");
        resetCompileState();
        return;
      }

      const data = await res.json().catch(() => ({}));
      if (typeof data.buildId === "string") {
        currentBuildIdRef.current = data.buildId;
      }

      startBuildPolling();
    } catch {
      setBuildStatus("error");
      resetCompileState();
    }
  }, [
    beginCompileTracking,
    canEdit,
    fixingWithAi,
    project.id,
    resetCompileState,
    saveViewPositionsBeforeBuild,
    startBuildPolling,
    withShareToken,
  ]);

  // ─── AI Chat Panel ────────────────────────────────

  const handleAskAi = useCallback(
    (selection: { fromLine: number; toLine: number; text: string }) => {
      setAiPendingSelection(selection);
      setAiTabActive(true);
    },
    []
  );

  /**
   * Live buffer when the file is open, else the last fetched copy.
   * Undefined means the server should read disk instead of trusting "".
   */
  const getAiFileContent = useCallback((fileId: string) => {
    return fileContentsRef.current.get(fileId);
  }, []);

  const texFiles = useMemo(
    () =>
      files
        .filter(
          (file) =>
            !file.isDirectory && file.path.toLowerCase().endsWith(".tex")
        )
        .map((file) => ({ id: file.id, path: file.path })),
    [files]
  );

  const texAnchor = useMemo(() => {
    const active = texFiles.find((file) => file.id === activeFileId);
    if (active) return active;
    const openTex = [...openFiles]
      .reverse()
      .map((open) => texFiles.find((file) => file.id === open.id))
      .find((file) => Boolean(file));
    if (openTex) return openTex;
    const main = texFiles.find((file) => file.path === mainFilePath);
    if (main) return main;
    return texFiles[0] ?? null;
  }, [activeFileId, mainFilePath, openFiles, texFiles]);

  const handleAiEditsApplied = useCallback(
    (touchedPaths: string[]) => {
      // A queued debounce save would PUT the pre-edit buffer back over the
      // content the AI just wrote through the file API.
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }

      touchedPaths.forEach((filePath) => {
        const touched = filesRef.current.find((file) => file.path === filePath);
        if (!touched) return;
        fileContentsRef.current.delete(touched.id);
        savedContentRef.current.delete(touched.id);
        setDirtyFileIds((prev) => {
          if (!prev.has(touched.id)) return prev;
          const next = new Set(prev);
          next.delete(touched.id);
          return next;
        });
        fetchFileContent(touched.id);
      });

      if (!autoCompileEnabledRef.current) return;
      if (compilingRef.current) {
        pendingRecompileRef.current = true;
        return;
      }
      handleCompile();
    },
    [fetchFileContent, handleCompile]
  );

  // A selection chip only makes sense for the file it was made in
  useEffect(() => {
    setAiPendingSelection(null);
  }, [activeFileId]);

  const handleFixWithAi = useCallback(async () => {
    if (!canEdit) return;
    if (fixingWithAi) return;
    if (compilingRef.current) return;
    if (!mainFilePath) return;

    const activeFilePath =
      activeFileId
        ? files.find((file) => file.id === activeFileId)?.path ?? mainFilePath
        : mainFilePath;

    setFixingWithAi(true);
    setAiFixExplanation(null);

    // Same reason as handleAiEditsApplied: a queued debounce save would undo
    // the AI's edits once savedContentRef is invalidated below.
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }

    try {
      // Persist current editor buffer before requesting AI fixes.
      if (activeFileId) {
        await handleSave(activeFileContent, false);
      }

      const res = await fetch("/api/ai/fix-build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          mainFile: mainFilePath,
          activeFilePath,
          activeFileContent,
          errorLimit: 8,
          recentBuildLimit: 3,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBuildStatus("error");
        setBuildLogs(data.error || "AI fix failed");
        resetCompileState();
        return;
      }

      if (typeof data.explanation === "string" && data.explanation.trim().length > 0) {
        setAiFixExplanation(data.explanation);
      }

      const touchedFilePaths = new Set<string>(
        Array.isArray(data.appliedEdits)
          ? data.appliedEdits
              .map((edit: { filePath?: string }) => edit.filePath)
              .filter((filePath: unknown): filePath is string => typeof filePath === "string")
          : []
      );

      if (touchedFilePaths.size > 0) {
        touchedFilePaths.forEach((filePath) => {
          const touched = files.find((file) => file.path === filePath);
          if (!touched) return;
          fileContentsRef.current.delete(touched.id);
          savedContentRef.current.delete(touched.id);
        });
      }

      if (activeFileId) {
        fetchFileContent(activeFileId);
      }

      const compileStatusCode =
        typeof data.compile?.statusCode === "number" ? data.compile.statusCode : 500;
      if (compileStatusCode >= 400) {
        setBuildStatus("error");
        const compileError =
          typeof data.compile?.result?.error === "string"
            ? data.compile.result.error
            : "AI fixes were applied, but compile could not be queued.";
        setBuildLogs(compileError);
        resetCompileState();
        return;
      }

      const queuedBuildId = data.compile?.result?.buildId;
      if (typeof queuedBuildId !== "string") {
        setBuildStatus("error");
        setBuildLogs("AI fixes were applied, but compile did not return a build ID.");
        resetCompileState();
        return;
      }

      setBuildActorName("You");
      setBuildStatus("queued");
      setBuildErrors([]);
      setPdfLoading(true);
      setCompiling(true);
      beginCompileTracking(queuedBuildId);
      compilingRef.current = true;
      pendingRecompileRef.current = false;
      saveViewPositionsBeforeBuild();
      startBuildPolling();
    } catch {
      setBuildStatus("error");
      setBuildLogs("AI fix failed. Please try again.");
      resetCompileState();
    } finally {
      setFixingWithAi(false);
    }
  }, [
    activeFileContent,
    activeFileId,
    beginCompileTracking,
    canEdit,
    fetchFileContent,
    files,
    fixingWithAi,
    handleSave,
    mainFilePath,
    project.id,
    resetCompileState,
    saveViewPositionsBeforeBuild,
    startBuildPolling,
  ]);

  const handleCancelBuild = useCallback(async () => {
    if (!canEdit) return;
    if (!(buildStatus === "compiling" || buildStatus === "queued")) return;
    const buildId = currentBuildIdRef.current;
    if (!buildId || buildId === "pending") return;

    try {
      const res = await fetch(
        withShareToken(
          `/api/projects/${project.id}/cancel?buildId=${encodeURIComponent(buildId)}`
        ),
        { method: "POST" }
      );

      if (!res.ok) {
        setBuildStatus("error");
        resetCompileState();
        return;
      }

      setBuildActorName("You");
      setBuildStatus("canceled");
      setBuildLogs("Build canceled by user.");
      setBuildDuration(null);
      setBuildErrors([]);
      pendingRecompileRef.current = false;
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      resetCompileState();
    } catch {
      setBuildStatus("error");
      resetCompileState();
    }
  }, [buildStatus, canEdit, project.id, resetCompileState, withShareToken]);

  // ─── Hard safety timeout ──────────────────────────
  // If we're stuck in "compiling" for 3 minutes, force-reset.
  // This prevents the UI from being stuck forever if both WS and polling fail.

  useEffect(() => {
    if (!compiling) return;

    const hardTimeout = setTimeout(() => {
      if (compilingRef.current) {
        console.warn("[Build] Hard timeout — resetting compile state after 3 minutes");
        setBuildStatus("timeout");
        setAutoCompileEnabled(false);
        pendingRecompileRef.current = false;
        resetCompileState();
      }
    }, 180_000);

    return () => clearTimeout(hardTimeout);
  }, [compiling, resetCompileState]);

  // ─── Keyboard shortcuts ───────────────────────────

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        handleCompile();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleImmediateSave();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleCompile, handleImmediateSave]);

  // ─── Refresh files ────────────────────────────────

  const refreshFiles = useCallback(async () => {
    try {
      const res = await fetch(withShareToken(`/api/projects/${project.id}/files`), {
        cache: "no-store",
      });
      if (res.ok) {
        const data = await res.json();
        const freshFiles = data.files as ProjectFile[];
        filesRef.current = freshFiles;
        setFiles(freshFiles);
        const freshPaths = new Map<string, string>(
          freshFiles.map((file) => [file.id, file.path] as const)
        );
        setOpenFiles((prev) =>
          prev.flatMap((file) => {
            const path = freshPaths.get(file.id);
            return path === undefined ? [] : [{ ...file, path }];
          })
        );
        // The active file can vanish here (deleted in another session, or
        // locally while the websocket is down and no file:deleted arrives).
        // Dropping its tab above would otherwise leave the editor mounted on
        // a dead id, so hand off to the same close path a tab click uses.
        const activeId = activeFileIdRef.current;
        if (activeId && !freshPaths.has(activeId)) {
          handleCloseTab(activeId);
        }

        const activeDocumentId = activeDocumentIdRef.current;
        if (
          !activeDocumentId ||
          !freshFiles.some(
            (file) => file.id === activeDocumentId && file.isDocument
          )
        ) {
          const nextDocument =
            freshFiles.find(
              (file) => file.isDocument && file.path === data.mainFile
            ) ?? freshFiles.find((file) => file.isDocument);
          activeDocumentIdRef.current = nextDocument?.id ?? null;
          activeDocumentPathRef.current = nextDocument?.path ?? null;
          setActiveDocumentId(nextDocument?.id ?? null);
        }
      }
    } catch {
      // Silently fail
    }
  }, [handleCloseTab, project.id, withShareToken]);

  const isImageFile = useCallback(
    (fileId: string | null): boolean => {
      if (!fileId) return false;
      const file = files.find((f) => f.id === fileId);
      return file?.mimeType?.startsWith("image/") ?? false;
    },
    [files]
  );

  const handlePdfTextSelect = useCallback((text: string, before: string, after: string) => {
    codeEditorRef.current?.highlightText(text, before, after);
  }, []);

  /** Navigate to the first build error's file and line */
  const navigateToFirstError = useCallback(
    (errors: LogError[]) => {
      const firstError = errors.find((e) => e.type === "error" && e.line > 0);
      if (!firstError) return;
      const target = files.find(
        (f) => f.path === firstError.file || f.path.endsWith(firstError.file) || `./${f.path}` === firstError.file
      );
      if (target) {
        // Open the file if not already active
        if (target.id !== activeFileIdRef.current) {
          handleFileSelect(target.id, target.path);
        }
        // Scroll to the error line (delay to allow file content to load)
        setTimeout(() => {
          codeEditorRef.current?.scrollToLine(firstError.line);
        }, 300);
      }
    },
    [files, handleFileSelect]
  );

  // Filter build errors for the currently active file
  const activeFileErrors = (() => {
    if (!activeFileId || buildErrors.length === 0) return [];
    const activeFile = files.find((f) => f.id === activeFileId);
    if (!activeFile) return [];
    return buildErrors.filter(
      (e) => e.type === "error" && (
        activeFile.path === e.file ||
        activeFile.path.endsWith(e.file) ||
        e.file.endsWith(activeFile.path) ||
        `./${activeFile.path}` === e.file
      )
    );
  })();

  const handleErrorClick = useCallback(
    (file: string, line: number) => {
      const target = files.find(
        (f) =>
          f.path === file ||
          f.path.endsWith(file) ||
          `./${f.path}` === file ||
          file.endsWith(f.path)
      );
      if (target) {
        handleFileSelect(target.id, target.path);
        // Scroll to the error line after the file loads
        setTimeout(() => {
          codeEditorRef.current?.scrollToLine(line);
        }, 200);
      }
    },
    [files, handleFileSelect]
  );

  const handleEditorPointerDown = useCallback(() => {
    if (followingUserIdRef.current) {
      setFollowingUserId(null);
    }
  }, []);

  // ─── Follow Mode ─────────────────────────────────

  const handleFollowUser = useCallback(
    (userId: string) => {
      if (followingUserId === userId) {
        setFollowingUserId(null);
        return;
      }
      setFollowingUserId(userId);

      // Jump to the user's current file
      const user = presenceUsers.find((u) => u.userId === userId);
      if (user?.activeFileId && user.activeFileId !== activeFileId) {
        const file = files.find((f) => f.id === user.activeFileId);
        if (file) {
          handleFileSelect(file.id, file.path, { preserveFollow: true });
        }
      }

      // Scroll to their cursor if we already have it
      const cursor = remoteCursors.get(userId);
      if (cursor) {
        codeEditorRef.current?.scrollToLine(cursor.selection.head.line);
      }
    },
    [followingUserId, presenceUsers, activeFileId, files, handleFileSelect, remoteCursors]
  );

  // Refresh share state (for header badge + chat visibility/history)
  useEffect(() => {
    refreshShareState();
  }, [refreshShareState]);

  // Auto-open the main file only when this browser has no saved tab state.
  useEffect(() => {
    if (!tabsRestored || restoredTabStateRef.current) return;
    if (autoOpenedMainRef.current) return;
    if (activeFileId || openFiles.length > 0) {
      autoOpenedMainRef.current = true;
      return;
    }
    if (files.length === 0) return;

    const mainFile =
      files.find((file) => file.id === activeDocumentId) ??
      files.find((file) => file.isDocument && file.path === project.mainFile);
    if (mainFile) {
      autoOpenedMainRef.current = true;
      handleFileSelect(mainFile.id, mainFile.path);
      return;
    }

    const fallbackTex =
      files.find((file) => file.isDocument) ??
      files.find((file) => !file.isDirectory && file.path.endsWith(".tex"));
    if (fallbackTex) {
      autoOpenedMainRef.current = true;
      handleFileSelect(fallbackTex.id, fallbackTex.path);
    }
  }, [
    activeDocumentId,
    activeFileId,
    files,
    handleFileSelect,
    openFiles.length,
    project.mainFile,
    tabsRestored,
  ]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearAllPolling();
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [clearAllPolling]);

  useEffect(() => {
    if (buildLogsExpanded) {
      buildLogsPanelRef.current?.expand();
      return;
    }
    buildLogsPanelRef.current?.collapse();
  }, [buildLogsExpanded]);

  return (
    <div className="flex h-full w-full flex-col bg-bg-tertiary">
      {/* Top header */}
      <EditorHeader
        projectName={project.name}
        projectId={project.id}
        documentPath={mainFilePath}
        compiling={compiling}
        onCompile={handleCompile}
        autoCompileEnabled={autoCompileEnabled}
        onAutoCompileToggle={(enabled) => setAutoCompileEnabled(enabled)}
        buildStatus={buildStatus}
        onCancelBuild={handleCancelBuild}
        presenceUsers={presenceUsers}
        currentUserId={currentUser.id}
        role={role}
        followingUserId={followingUserId}
        onFollowUser={handleFollowUser}
        isSharedProject={isSharedProject}
        shareToken={shareToken}
        canEdit={canEdit}
      />

      {/* Main content area */}
      <div className="relative min-h-0 flex-1 bg-bg-tertiary">
        <PanelGroup
          direction="vertical"
          className="h-full w-full"
          autoSaveId={`editor-layout-${project.id}-vertical`}
        >
          {/* Editor panels */}
          <Panel defaultSize={80} minSize={40}>
            <PanelGroup
              direction="horizontal"
              className="h-full w-full"
              autoSaveId={`editor-layout-${project.id}-horizontal`}
            >
              {/* File tree */}
              <Panel defaultSize={15} minSize={10} collapsible>
                <FileTree
                  projectId={project.id}
                  files={files}
                  activeFileId={activeFileId}
                  mainFilePath={mainFilePath ?? ""}
                  onFileSelect={handleFileSelect}
                  onMainFileChange={(nextMainFilePath) => {
                    const document = filesRef.current.find(
                      (file) => file.isDocument && file.path === nextMainFilePath
                    );
                    if (!document) return;
                    activeDocumentIdRef.current = document.id;
                    activeDocumentPathRef.current = document.path;
                    setActiveDocumentId(document.id);
                  }}
                  onFilesChanged={refreshFiles}
                  shareToken={shareToken}
                  readOnly={!canEdit}
                />
              </Panel>

              <PanelResizeHandle className={RESIZE_HANDLE_COL} />

              {/* Code editor (+ optional AI chat tab) */}
              <Panel defaultSize={45} minSize={20}>
                <div className="flex h-full flex-col bg-bg-primary">
                  <EditorTabs
                    openFiles={openFiles}
                    activeFileId={activeFileId}
                    dirtyFileIds={dirtyFileIds}
                    onSelectTab={(fileId) => {
                      const filePath =
                        openFiles.find((f) => f.id === fileId)?.path ??
                        files.find((f) => f.id === fileId)?.path ??
                        null;
                      handleFileSelect(fileId, filePath);
                    }}
                    onCloseTab={handleCloseTab}
                    aiTab={
                      canUseAi
                        ? {
                            active: aiTabActive,
                            onSelect: () => setAiTabActive(true),
                          }
                        : undefined
                    }
                  />
                  <div className={cn("flex-1 min-h-0", aiTabActive && "hidden")}>
                    {activeFileId ? (
                      isImageFile(activeFileId) ? (
                        <div className="flex h-full items-center justify-center overflow-auto bg-bg-inset p-6">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={withShareToken(
                              `/api/projects/${project.id}/files/${activeFileId}?raw`
                            )}
                            alt={openFiles.find((f) => f.id === activeFileId)?.path ?? "Image"}
                            className="max-h-full max-w-full rounded-sm object-contain shadow-md"
                          />
                        </div>
                      ) : (
                        <CodeEditor
                          ref={codeEditorRef}
                          content={activeFileContent}
                          onChange={handleEditorChange}
                          language="latex"
                          readOnly={!canEdit}
                          errors={activeFileErrors}
                          onDocChange={(changes) => {
                            if (activeFileId) sendDocChange(activeFileId, changes, Date.now());
                          }}
                          onCursorChange={(selection) => {
                            if (activeFileId) sendCursorMove(activeFileId, selection);
                          }}
                          remoteChanges={remoteChanges}
                          remoteCursors={remoteCursors}
                          hideLocalCursor={Boolean(followingUserId)}
                          onEditorPointerDown={handleEditorPointerDown}
                          onAskAi={canUseAi ? handleAskAi : undefined}
                        />
                      )
                    ) : (
                      <div className="flex h-full animate-fade-in items-center justify-center bg-bg-primary">
                        <div className="flex flex-col items-center gap-2.5 px-4 text-center">
                          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border-subtle bg-bg-elevated">
                            <FileText className="h-4 w-4 text-text-muted" />
                          </div>
                          <p className="text-sm font-medium text-text-secondary">
                            No file open
                          </p>
                          <p className="max-w-[32ch] text-xs text-text-muted">
                            Pick a file in the tree on the left to start editing.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* AI chat — mounted while its tab exists so switching
                      tabs does not throw away the conversation */}
                  {canUseAi && (
                    <div className={cn("flex-1 min-h-0", !aiTabActive && "hidden")}>
                      <AiChatPanel
                        projectId={project.id}
                        files={texFiles}
                        anchorFile={texAnchor}
                        getFileContent={getAiFileContent}
                        ensureFileContent={fetchFileContent}
                        pendingSelection={aiPendingSelection}
                        onClearSelection={() => setAiPendingSelection(null)}
                        onEditsApplied={handleAiEditsApplied}
                      />
                    </div>
                  )}
                </div>
              </Panel>

              <PanelResizeHandle className={RESIZE_HANDLE_COL} />

              {/* PDF viewer */}
              <Panel defaultSize={40} minSize={15}>
                <PdfViewer
                  ref={pdfViewerRef}
                  pdfUrl={pdfUrl}
                  loading={pdfLoading}
                  onTextSelect={handlePdfTextSelect}
                  toolbarExtra={
                    <ProjectActions
                      projectId={project.id}
                      projectName={project.name}
                      isOwner={role === "owner"}
                      canManageShare={!isPublicShare && role === "owner"}
                      shareToken={shareToken}
                      onShareUpdated={refreshShareState}
                    />
                  }
                />
              </Panel>
            </PanelGroup>
          </Panel>

          <PanelResizeHandle className={RESIZE_HANDLE_ROW} />

          {/* Build logs */}
          <Panel
            ref={buildLogsPanelRef}
            defaultSize={20}
            minSize={5}
            collapsible
            collapsedSize={4}
            onCollapse={() => setBuildLogsExpanded(false)}
            onExpand={() => setBuildLogsExpanded(true)}
          >
            <BuildLogs
              logs={buildLogs}
              status={buildStatus}
              duration={buildDuration}
              errors={buildErrors}
              actorName={buildActorName}
              onErrorClick={handleErrorClick}
              canFixWithAi={canEdit && !shareToken}
              fixingWithAi={fixingWithAi}
              onFixWithAi={handleFixWithAi}
              aiExplanation={aiFixExplanation}
              expanded={buildLogsExpanded}
              onExpandedChange={setBuildLogsExpanded}
            />
          </Panel>
        </PanelGroup>

        {/* Chat Panel */}
        {isSharedProject && (
          <ChatPanel
            messages={chatMessages}
            onSendMessage={sendChatMessage}
            currentUserId={currentUser.id}
            userColors={userColorMap}
            userNames={userNameMap}
            readState={chatReadState}
            onMarkRead={sendChatRead}
            shareHistoryEntries={shareHistoryEntries}
          />
        )}
      </div>
    </div>
  );
}
