"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils/cn";
import {
  File,
  Folder,
  FolderOpen,
  FilePlus,
  FolderPlus,
  Trash2,
  Pencil,
  Upload,
  ChevronRight,
  ChevronDown,
  Flag,
  Copy,
  ClipboardPaste,
} from "lucide-react";
import FileIcon from "./FileIcon";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

// ─── Types ──────────────────────────────────────────

interface ProjectFile {
  id: string;
  projectId: string;
  path: string;
  mimeType: string | null;
  sizeBytes: number | null;
  isDirectory: boolean | null;
  createdAt: string;
  updatedAt: string;
}

interface TreeNode {
  name: string;
  path: string;
  file: ProjectFile | null;
  isDirectory: boolean;
  children: TreeNode[];
}

interface FileTreeProps {
  projectId: string;
  files: ProjectFile[];
  activeFileId: string | null;
  mainFilePath: string;
  onFileSelect: (fileId: string, filePath: string) => void;
  onMainFileChange: (mainFilePath: string) => void;
  onFilesChanged: () => void;
  shareToken?: string | null;
  readOnly?: boolean;
}

// ─── Build tree structure from flat file list ───────

function buildTree(files: ProjectFile[]): TreeNode[] {
  const root: TreeNode[] = [];

  // Sort directories first, then alphabetically
  const sorted = [...files].sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    return a.path.localeCompare(b.path);
  });

  for (const file of sorted) {
    const parts = file.path.split("/");
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const existingNode = current.find((n) => n.name === part);

      if (existingNode) {
        if (isLast) {
          existingNode.file = file;
          existingNode.isDirectory = !!file.isDirectory;
        }
        current = existingNode.children;
      } else {
        const newNode: TreeNode = {
          name: part,
          path: parts.slice(0, i + 1).join("/"),
          file: isLast ? file : null,
          isDirectory: isLast ? !!file.isDirectory : true,
          children: [],
        };
        current.push(newNode);
        current = newNode.children;
      }
    }
  }

  return root;
}

function getParentPath(filePath: string): string {
  const idx = filePath.lastIndexOf("/");
  return idx === -1 ? "" : filePath.slice(0, idx);
}

/** DFS traversal returning file IDs in visual order (skips directories). */
function flattenTree(nodes: TreeNode[]): string[] {
  const result: string[] = [];
  function walk(list: TreeNode[]) {
    for (const node of list) {
      if (!node.isDirectory && node.file) {
        result.push(node.file.id);
      }
      if (node.children.length > 0) {
        walk(node.children);
      }
    }
  }
  walk(nodes);
  return result;
}

/** Generate a "copy" path for a file, avoiding collisions with existing paths. */
function getCopyPath(originalPath: string, existingPaths: Set<string>): string {
  const lastSlash = originalPath.lastIndexOf("/");
  const dir = lastSlash >= 0 ? originalPath.slice(0, lastSlash + 1) : "";
  const filename = lastSlash >= 0 ? originalPath.slice(lastSlash + 1) : originalPath;
  const dotIdx = filename.lastIndexOf(".");
  const name = dotIdx > 0 ? filename.slice(0, dotIdx) : filename;
  const ext = dotIdx > 0 ? filename.slice(dotIdx) : "";

  let candidate = `${dir}${name} copy${ext}`;
  let counter = 2;
  while (existingPaths.has(candidate)) {
    candidate = `${dir}${name} copy ${counter}${ext}`;
    counter++;
  }
  return candidate;
}

// ─── Folder Drag-and-Drop from OS ───────────────────

async function collectDroppedFiles(
  dataTransfer: DataTransfer
): Promise<{ file: File; path: string }[]> {
  const result: { file: File; path: string }[] = [];

  // Try the FileSystemEntry API for full folder support
  const items = dataTransfer.items;
  if (items) {
    const entries: FileSystemEntry[] = [];
    for (let i = 0; i < items.length; i++) {
      const entry = items[i].webkitGetAsEntry?.();
      if (entry) entries.push(entry);
    }

    if (entries.length > 0) {
      async function traverse(entry: FileSystemEntry, parentPath: string) {
        if (entry.isFile) {
          const file = await new Promise<File>((resolve, reject) =>
            (entry as FileSystemFileEntry).file(resolve, reject)
          );
          result.push({
            file,
            path: parentPath ? `${parentPath}/${entry.name}` : entry.name,
          });
        } else if (entry.isDirectory) {
          const dirPath = parentPath
            ? `${parentPath}/${entry.name}`
            : entry.name;
          const children = await new Promise<FileSystemEntry[]>(
            (resolve, reject) => {
              const reader = (
                entry as FileSystemDirectoryEntry
              ).createReader();
              const all: FileSystemEntry[] = [];
              function readBatch() {
                reader.readEntries((batch) => {
                  if (batch.length === 0) resolve(all);
                  else {
                    all.push(...batch);
                    readBatch();
                  }
                }, reject);
              }
              readBatch();
            }
          );
          for (const child of children) {
            await traverse(child, dirPath);
          }
        }
      }

      for (const entry of entries) {
        await traverse(entry, "");
      }
      return result;
    }
  }

  // Fallback: plain FileList (no folder support)
  for (let i = 0; i < dataTransfer.files.length; i++) {
    const file = dataTransfer.files[i];
    result.push({ file, path: file.name });
  }
  return result;
}

// ─── Context Menu ───────────────────────────────────

interface ContextMenuProps {
  x: number;
  y: number;
  selectedCount: number;
  canSetEntrypoint: boolean;
  isEntrypoint: boolean;
  hasCopied: boolean;
  onSetEntrypoint: () => void;
  onDelete: () => void;
  onRename: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onClose: () => void;
}

function ContextMenu({
  x,
  y,
  selectedCount,
  canSetEntrypoint,
  isEntrypoint,
  hasCopied,
  onSetEntrypoint,
  onDelete,
  onRename,
  onCopy,
  onPaste,
  onClose,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const isMulti = selectedCount > 1;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[140px] rounded-lg border border-border bg-bg-secondary py-1 shadow-lg"
      style={{ left: x, top: y }}
    >
      {!isMulti && canSetEntrypoint && (
        <button
          type="button"
          disabled={isEntrypoint}
          onClick={onSetEntrypoint}
          className={cn(
            "flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors",
            isEntrypoint
              ? "cursor-default text-text-muted"
              : "text-accent hover:bg-bg-elevated"
          )}
        >
          <Flag className="h-4 w-4" />
          {isEntrypoint ? "Current entrypoint" : "Set as entrypoint"}
        </button>
      )}
      {!isMulti && (
        <button
          type="button"
          onClick={onRename}
          className="flex w-full items-center gap-2 px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-bg-elevated hover:text-text-primary"
        >
          <Pencil className="h-4 w-4" />
          Rename
        </button>
      )}
      <button
        type="button"
        onClick={onCopy}
        className="flex w-full items-center gap-2 px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-bg-elevated hover:text-text-primary"
      >
        <Copy className="h-4 w-4" />
        {isMulti ? `Copy ${selectedCount} files` : "Copy"}
      </button>
      {hasCopied && (
        <button
          type="button"
          onClick={onPaste}
          className="flex w-full items-center gap-2 px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-bg-elevated hover:text-text-primary"
        >
          <ClipboardPaste className="h-4 w-4" />
          Paste
        </button>
      )}
      <button
        type="button"
        onClick={onDelete}
        className="flex w-full items-center gap-2 px-3 py-2 text-sm text-error transition-colors hover:bg-bg-elevated"
      >
        <Trash2 className="h-4 w-4" />
        {isMulti ? `Delete ${selectedCount} files` : "Delete"}
      </button>
    </div>
  );
}

// ─── Tree Node Item ─────────────────────────────────

interface TreeNodeItemProps {
  node: TreeNode;
  depth: number;
  activeFileId: string | null;
  mainFilePath: string;
  renamingFileId: string | null;
  dropTargetPath: string | null;
  selectedFileIds: Set<string>;
  onFileSelect: (fileId: string, filePath: string) => void;
  onFileClick: (fileId: string, filePath: string, e: React.MouseEvent) => void;
  onDeleteFile: (fileId: string) => void;
  onContextMenu: (e: React.MouseEvent, file: ProjectFile) => void;
  onRenameSubmit: (fileId: string, oldPath: string, newName: string) => void;
  onRenameCancel: () => void;
  onDragStartInternal: (fileId: string, filePath: string) => void;
  onDragEndInternal: () => void;
  onDragOverFolder: (folderPath: string) => void;
  onDropOnFolder: (fileId: string, filePath: string, targetPath: string) => void;
}

function TreeNodeItem({
  node,
  depth,
  activeFileId,
  mainFilePath,
  renamingFileId,
  dropTargetPath,
  selectedFileIds,
  onFileSelect,
  onFileClick,
  onDeleteFile,
  onContextMenu,
  onRenameSubmit,
  onRenameCancel,
  onDragStartInternal,
  onDragEndInternal,
  onDragOverFolder,
  onDropOnFolder,
}: TreeNodeItemProps) {
  const [expanded, setExpanded] = useState(depth < 1);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);
  const isActive = node.file?.id === activeFileId;
  const isSelected = node.file ? selectedFileIds.has(node.file.id) : false;
  const isRenaming = node.file?.id === renamingFileId;
  const isEntrypoint = !!node.file && !node.isDirectory && node.file.path === mainFilePath;

  useEffect(() => {
    if (isRenaming) {
      setRenameValue(node.name);
      setTimeout(() => {
        if (renameInputRef.current) {
          renameInputRef.current.focus();
          // Select the name without extension for files
          if (!node.isDirectory) {
            const dotIdx = node.name.lastIndexOf(".");
            if (dotIdx > 0) {
              renameInputRef.current.setSelectionRange(0, dotIdx);
            } else {
              renameInputRef.current.select();
            }
          } else {
            renameInputRef.current.select();
          }
        }
      }, 0);
    }
  }, [isRenaming, node.name, node.isDirectory]);

  function handleClick(e: React.MouseEvent) {
    if (isRenaming) return;
    if (node.isDirectory) {
      setExpanded(!expanded);
    } else if (node.file) {
      onFileClick(node.file.id, node.file.path, e);
    }
  }

  function handleRightClick(e: React.MouseEvent) {
    e.preventDefault();
    if (node.file) {
      onContextMenu(e, node.file);
    }
  }

  function handleRenameSubmit() {
    if (!node.file) return;
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === node.name) {
      onRenameCancel();
      return;
    }
    onRenameSubmit(node.file.id, node.file.path, trimmed);
  }

  return (
    <div>
      <button
        type="button"
        draggable={!!node.file && !isRenaming}
        onClick={handleClick}
        onContextMenu={handleRightClick}
        onDragStart={(e) => {
          if (!node.file) return;
          e.dataTransfer.setData("application/x-backslash-file-id", node.file.id);
          e.dataTransfer.setData("application/x-backslash-file-path", node.file.path);
          e.dataTransfer.effectAllowed = "move";
          onDragStartInternal(node.file.id, node.file.path);
        }}
        onDragEnd={onDragEndInternal}
        onDragOver={(e) => {
          if (!node.isDirectory) return;
          if (e.dataTransfer.types.includes("application/x-backslash-file-id")) {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = "move";
            onDragOverFolder(node.path);
          }
        }}
        onDrop={(e) => {
          if (!node.isDirectory) return;
          const fId = e.dataTransfer.getData("application/x-backslash-file-id");
          const fPath = e.dataTransfer.getData("application/x-backslash-file-path");
          if (fId && fPath) {
            e.preventDefault();
            e.stopPropagation();
            onDropOnFolder(fId, fPath, node.path);
          }
        }}
        className={cn(
          "flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm transition-colors",
          isActive
            ? "bg-accent/15 text-accent"
            : isSelected
              ? "bg-accent/10 text-accent/80"
              : "text-text-secondary hover:bg-bg-elevated hover:text-text-primary",
          dropTargetPath === node.path && node.isDirectory && "ring-2 ring-accent/50 bg-accent/10"
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        {node.isDirectory ? (
          <>
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-muted" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-muted" />
            )}
            {expanded ? (
              <FolderOpen className="h-4 w-4 shrink-0 text-accent" />
            ) : (
              <Folder className="h-4 w-4 shrink-0 text-accent" />
            )}
          </>
        ) : (
          <>
            <span className="w-3.5 shrink-0" />
            <FileIcon extension={node.path.split(".").pop() ?? ""} className="h-4 w-4 shrink-0 text-text-muted" />
          </>
        )}
        {isRenaming ? (
          <input
            ref={renameInputRef}
            type="text"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={handleRenameSubmit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleRenameSubmit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                onRenameCancel();
              }
            }}
            onClick={(e) => e.stopPropagation()}
            className="w-full min-w-0 rounded border border-accent bg-bg-tertiary px-1 py-0 text-sm text-text-primary outline-none"
          />
        ) : (
          <>
            <span className="min-w-0 flex-1 truncate">{node.name}</span>
            {isEntrypoint && (
              <span className="shrink-0 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
                Entry
              </span>
            )}
          </>
        )}
      </button>

      {node.isDirectory && expanded && (
        <div>
          {node.children.map((child) => (
            <TreeNodeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              activeFileId={activeFileId}
              mainFilePath={mainFilePath}
              renamingFileId={renamingFileId}
              dropTargetPath={dropTargetPath}
              selectedFileIds={selectedFileIds}
              onFileSelect={onFileSelect}
              onFileClick={onFileClick}
              onDeleteFile={onDeleteFile}
              onContextMenu={onContextMenu}
              onRenameSubmit={onRenameSubmit}
              onRenameCancel={onRenameCancel}
              onDragStartInternal={onDragStartInternal}
              onDragEndInternal={onDragEndInternal}
              onDragOverFolder={onDragOverFolder}
              onDropOnFolder={onDropOnFolder}
            />
          ))}
          {node.children.length === 0 && (
            <div
              className="px-2 py-1 text-xs text-text-muted italic"
              style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}
            >
              Empty folder
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── File Tree ──────────────────────────────────────

export function FileTree({
  projectId,
  files,
  activeFileId,
  mainFilePath,
  onFileSelect,
  onMainFileChange,
  onFilesChanged,
  shareToken = null,
  readOnly = false,
}: FileTreeProps) {
  const [creating, setCreating] = useState<"file" | "folder" | null>(null);
  const [newName, setNewName] = useState("");
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    file: ProjectFile;
  } | null>(null);
  const [renamingFileId, setRenamingFileId] = useState<string | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ fileId: string } | null>(null);
  const [alertMessage, setAlertMessage] = useState<string | null>(null);
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
  const [lastClickedFileId, setLastClickedFileId] = useState<string | null>(null);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState<Set<string> | null>(null);
  const [copiedFileIds, setCopiedFileIds] = useState<string[]>([]);
  const dragCounter = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const treeContainerRef = useRef<HTMLDivElement>(null);

  const withShareToken = useCallback(
    (url: string) => {
      if (!shareToken) return url;
      const separator = url.includes("?") ? "&" : "?";
      return `${url}${separator}share=${encodeURIComponent(shareToken)}`;
    },
    [shareToken]
  );

  useEffect(() => {
    if (creating && inputRef.current) {
      inputRef.current.focus();
    }
  }, [creating]);

  const tree = buildTree(files);
  const flatFileIds = useMemo(() => flattenTree(tree), [tree]);

  // ─── Multi-select click handler ────────────────────

  const handleFileClick = useCallback(
    (fileId: string, filePath: string, e: React.MouseEvent) => {
      if (readOnly) {
        onFileSelect(fileId, filePath);
        return;
      }

      if (e.shiftKey && lastClickedFileId) {
        // Range select
        e.preventDefault();
        const anchorIdx = flatFileIds.indexOf(lastClickedFileId);
        const targetIdx = flatFileIds.indexOf(fileId);
        if (anchorIdx !== -1 && targetIdx !== -1) {
          const start = Math.min(anchorIdx, targetIdx);
          const end = Math.max(anchorIdx, targetIdx);
          const range = new Set(flatFileIds.slice(start, end + 1));
          setSelectedFileIds(range);
        }
        treeContainerRef.current?.focus();
      } else if (e.ctrlKey || e.metaKey) {
        // Toggle select — include activeFileId if starting fresh
        setSelectedFileIds((prev) => {
          const next = new Set(prev);
          if (next.size === 0 && activeFileId && activeFileId !== fileId) {
            next.add(activeFileId);
          }
          if (next.has(fileId)) {
            next.delete(fileId);
          } else {
            next.add(fileId);
          }
          return next;
        });
        setLastClickedFileId(fileId);
        treeContainerRef.current?.focus();
      } else {
        // Plain click — clear selection, open file
        setSelectedFileIds(new Set());
        setLastClickedFileId(fileId);
        onFileSelect(fileId, filePath);
      }
    },
    [readOnly, lastClickedFileId, flatFileIds, onFileSelect]
  );

  // ─── Copy & Paste files ─────────────────────────────

  const handlePasteFiles = useCallback(
    async () => {
      if (copiedFileIds.length === 0) return;
      const existingPaths = new Set(files.map((f) => f.path));

      try {
        for (const fileId of copiedFileIds) {
          const file = files.find((f) => f.id === fileId);
          if (!file || file.isDirectory) continue;

          const copyPath = getCopyPath(file.path, existingPaths);
          existingPaths.add(copyPath);

          const isBinary = file.mimeType?.startsWith("image/") ||
            file.mimeType === "application/pdf" ||
            file.mimeType === "application/octet-stream";

          if (isBinary) {
            // Binary files: fetch raw bytes and upload via FormData
            const res = await fetch(
              withShareToken(`/api/projects/${projectId}/files/${fileId}?raw`)
            );
            if (!res.ok) continue;
            const blob = await res.blob();
            const NativeFile = globalThis.File;
            const copyFile = new NativeFile([blob], copyPath.split("/").pop()!, { type: file.mimeType ?? undefined });

            const formData = new FormData();
            formData.append("files", copyFile);
            formData.append("paths", copyPath);

            await fetch(
              withShareToken(`/api/projects/${projectId}/files/upload`),
              { method: "POST", body: formData }
            );
          } else {
            // Text files: fetch JSON content and create via POST
            const res = await fetch(
              withShareToken(`/api/projects/${projectId}/files/${fileId}`)
            );
            if (!res.ok) continue;
            const data = await res.json();

            await fetch(withShareToken(`/api/projects/${projectId}/files`), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                path: copyPath,
                content: data.content ?? "",
              }),
            });
          }
        }
        onFilesChanged();
      } catch {
        // Silently fail
      }
    },
    [copiedFileIds, files, onFilesChanged, projectId, withShareToken]
  );

  // ─── Keyboard shortcuts (scoped to tree container) ─

  useEffect(() => {
    const container = treeContainerRef.current;
    if (!container || readOnly) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedFileIds.size > 0) {
          e.preventDefault();
          setBulkDeleteConfirm(new Set(selectedFileIds));
        } else if (activeFileId) {
          e.preventDefault();
          setDeleteConfirm({ fileId: activeFileId });
        }
      } else if (e.key === "Escape") {
        setSelectedFileIds(new Set());
      } else if ((e.ctrlKey || e.metaKey) && e.key === "a") {
        e.preventDefault();
        setSelectedFileIds(new Set(flatFileIds));
      } else if ((e.ctrlKey || e.metaKey) && e.key === "c") {
        const ids = selectedFileIds.size > 0
          ? [...selectedFileIds]
          : activeFileId ? [activeFileId] : [];
        if (ids.length > 0) {
          e.preventDefault();
          setCopiedFileIds(ids);
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key === "v") {
        if (copiedFileIds.length > 0) {
          e.preventDefault();
          handlePasteFiles();
        }
      }
    }

    container.addEventListener("keydown", handleKeyDown);
    return () => container.removeEventListener("keydown", handleKeyDown);
  }, [readOnly, selectedFileIds, flatFileIds, activeFileId, copiedFileIds, handlePasteFiles]);

  // ─── Prune stale selections when files change ──────

  useEffect(() => {
    const validIds = new Set(files.filter((f) => !f.isDirectory).map((f) => f.id));
    setSelectedFileIds((prev) => {
      const pruned = new Set([...prev].filter((id) => validIds.has(id)));
      if (pruned.size !== prev.size) return pruned;
      return prev;
    });
  }, [files]);

  // ─── Bulk delete ───────────────────────────────────

  const confirmBulkDelete = useCallback(
    async () => {
      if (!bulkDeleteConfirm) return;
      const idsToDelete = [...bulkDeleteConfirm];
      setBulkDeleteConfirm(null);
      setSelectedFileIds(new Set());

      try {
        for (const fileId of idsToDelete) {
          await fetch(
            withShareToken(`/api/projects/${projectId}/files/${fileId}`),
            { method: "DELETE" }
          );
        }
        onFilesChanged();
      } catch {
        // Silently fail
      }
    },
    [bulkDeleteConfirm, onFilesChanged, projectId, withShareToken]
  );

  // ─── Rename API call ──────────────────────────────

  const handleMove = useCallback(
    async (fileId: string, newPath: string) => {
      try {
        const res = await fetch(
          withShareToken(`/api/projects/${projectId}/files/${fileId}`),
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ newPath }),
          }
        );
        if (res.ok) {
          const data = await res.json();
          if (typeof data.mainFile === "string") {
            onMainFileChange(data.mainFile);
          }
          onFilesChanged();
        }
      } catch {
        // Silently fail
      }
    },
    [onFilesChanged, onMainFileChange, projectId, withShareToken]
  );

  // ─── Internal drag-and-drop (move files between folders) ──

  const handleInternalDragStart = useCallback(() => {
    // Could add visual feedback here (e.g. opacity)
  }, []);

  const handleInternalDragEnd = useCallback(() => {
    setDropTargetPath(null);
  }, []);

  const handleDragOverFolder = useCallback((folderPath: string) => {
    setDropTargetPath(folderPath);
  }, []);

  const handleDropOnFolder = useCallback(
    (fileId: string, filePath: string, targetFolderPath: string) => {
      setDropTargetPath(null);
      // Don't allow dropping a folder into itself or its children
      if (targetFolderPath === filePath || targetFolderPath.startsWith(filePath + "/")) {
        return;
      }
      const fileName = filePath.split("/").pop()!;
      const newPath = targetFolderPath
        ? `${targetFolderPath}/${fileName}`
        : fileName;
      if (newPath !== filePath) {
        handleMove(fileId, newPath);
      }
    },
    [handleMove]
  );

  // ─── File upload via drag-and-drop from OS ────────

  const uploadFiles = useCallback(
    async (fileEntries: { file: File; path: string }[]) => {
      if (fileEntries.length === 0) return;
      setUploading(true);

      try {
        const formData = new FormData();

        for (const entry of fileEntries) {
          formData.append("files", entry.file);
          formData.append("paths", entry.path);
        }

        const res = await fetch(
          withShareToken(`/api/projects/${projectId}/files/upload`),
          {
            method: "POST",
            body: formData,
          }
        );

        if (res.ok) {
          onFilesChanged();
        }
      } catch {
        // Silently fail
      } finally {
        setUploading(false);
      }
    },
    [onFilesChanged, projectId, withShareToken]
  );

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.types.includes("Files")) {
      setIsDraggingOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setIsDraggingOver(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes("application/x-backslash-file-id")) {
      e.dataTransfer.dropEffect = "move";
      setDropTargetPath(null); // Clear folder highlight when over root area
    } else {
      e.dataTransfer.dropEffect = "copy";
    }
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter.current = 0;
      setIsDraggingOver(false);

      // Internal file move — drop on root area moves file to top level
      const draggedId = e.dataTransfer.getData("application/x-backslash-file-id");
      const draggedPath = e.dataTransfer.getData("application/x-backslash-file-path");
      if (draggedId && draggedPath) {
        setDropTargetPath(null);
        const fileName = draggedPath.split("/").pop()!;
        if (draggedPath !== fileName) {
          handleMove(draggedId, fileName);
        }
        return;
      }

      // External files — supports folders via FileSystemEntry API
      const entries = await collectDroppedFiles(e.dataTransfer);
      uploadFiles(entries);
    },
    [uploadFiles, handleMove]
  );

  // ─── Rename handlers ─────────────────────────────

  const handleRenameSubmit = useCallback(
    (fileId: string, oldPath: string, newName: string) => {
      setRenamingFileId(null);
      if (!newName) return;

      const parent = getParentPath(oldPath);
      const newPath = parent ? parent + "/" + newName : newName;

      if (newPath !== oldPath) {
        handleMove(fileId, newPath);
      }
    },
    [handleMove]
  );

  const handleRenameCancel = useCallback(() => {
    setRenamingFileId(null);
  }, []);

  // ─── Create file / folder ────────────────────────

  const handleCreate = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!newName.trim() || !creating) return;

      try {
        const res = await fetch(withShareToken(`/api/projects/${projectId}/files`), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            path: newName.trim(),
            content: creating === "file" ? "" : undefined,
            isDirectory: creating === "folder",
          }),
        });

        if (res.ok) {
          onFilesChanged();
        }
      } catch {
        // Silently fail
      } finally {
        setCreating(null);
        setNewName("");
      }
    },
    [creating, newName, onFilesChanged, projectId, withShareToken]
  );

  // ─── Delete file ─────────────────────────────────

  const handleDeleteFile = useCallback(
    (fileId: string) => {
      setDeleteConfirm({ fileId });
    },
    []
  );

  const confirmDelete = useCallback(
    async () => {
      if (!deleteConfirm) return;
      const { fileId } = deleteConfirm;
      setDeleteConfirm(null);

      try {
        const res = await fetch(
          withShareToken(`/api/projects/${projectId}/files/${fileId}`),
          { method: "DELETE" }
        );

        if (res.ok) {
          const data = await res.json();
          if (typeof data.mainFile === "string") {
            onMainFileChange(data.mainFile);
          }
          onFilesChanged();
        }
      } catch {
        // Silently fail
      }
    },
    [deleteConfirm, onFilesChanged, onMainFileChange, projectId, withShareToken]
  );

  const handleSetEntrypoint = useCallback(
    async (filePath: string) => {
      try {
        const res = await fetch(
          withShareToken(`/api/projects/${projectId}/entrypoint`),
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mainFile: filePath }),
          }
        );

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setAlertMessage(data.error || "Failed to set entrypoint");
          return;
        }

        const data = await res.json().catch(() => ({}));
        onMainFileChange(
          typeof data.mainFile === "string" ? data.mainFile : filePath
        );
      } catch {
        setAlertMessage("Failed to set entrypoint");
      }
    },
    [onMainFileChange, projectId, withShareToken]
  );

  // ─── Context menu handlers ───────────────────────

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, file: ProjectFile) => {
      e.preventDefault();
      // If right-clicking a file not in the selection, clear selection
      if (!selectedFileIds.has(file.id)) {
        setSelectedFileIds(new Set());
      }
      setContextMenu({ x: e.clientX, y: e.clientY, file });
    },
    [selectedFileIds]
  );

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  return (
    <div
      className={cn(
        "flex h-full flex-col bg-bg-secondary transition-colors",
        isDraggingOver && "ring-2 ring-inset ring-accent/50 bg-accent/5"
      )}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Hidden file picker input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".tex,.bib,.cls,.sty,.bst,.png,.jpg,.jpeg,.gif,.svg,.pdf,.eps,.ps,.txt,.md,.csv,.dat,.tikz,.pgf"
        className="hidden"
        onChange={(e) => {
          const fileList = e.target.files;
          if (!fileList || fileList.length === 0) return;
          const entries: { file: File; path: string }[] = [];
          for (let i = 0; i < fileList.length; i++) {
            entries.push({ file: fileList[i], path: fileList[i].name });
          }
          uploadFiles(entries);
          e.target.value = "";
        }}
      />

      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
          Files
        </span>
        {!readOnly && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                setCreating("file");
                setNewName("");
              }}
              title="New File"
              className="rounded p-1 text-text-muted transition-colors hover:text-text-primary hover:bg-bg-elevated"
            >
              <FilePlus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                setCreating("folder");
                setNewName("");
              }}
              title="New Folder"
              className="rounded p-1 text-text-muted transition-colors hover:text-text-primary hover:bg-bg-elevated"
            >
              <FolderPlus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              title="Upload Files"
              className="rounded p-1 text-text-muted transition-colors hover:text-text-primary hover:bg-bg-elevated"
            >
              <Upload className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {/* New file/folder input */}
      {creating && (
        <form onSubmit={handleCreate} className="border-b border-border px-2 py-2">
          <div className="flex items-center gap-1.5">
            {creating === "folder" ? (
              <Folder className="h-4 w-4 shrink-0 text-accent" />
            ) : (
              <FileIcon extension={newName.split(".").pop() ?? ""}className="h-4 w-4 shrink-0 text-text-muted" />
            )}
            <input
              ref={inputRef}
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onBlur={() => {
                if (!newName.trim()) setCreating(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setCreating(null);
                  setNewName("");
                }
              }}
              placeholder={
                creating === "folder" ? "folder-name" : "filename.tex"
              }
              className="w-full rounded border border-accent bg-bg-tertiary px-1.5 py-0.5 text-sm text-text-primary placeholder:text-text-muted outline-none"
            />
          </div>
        </form>
      )}

      {/* Uploading indicator */}
      {uploading && (
        <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs text-accent">
          <Upload className="h-3.5 w-3.5 animate-pulse" />
          Uploading...
        </div>
      )}

      {/* Tree content */}
      <div
        ref={treeContainerRef}
        tabIndex={0}
        className="flex-1 overflow-y-auto px-1 py-1 outline-none"
      >
        {/* Drop overlay */}
        {isDraggingOver && (
          <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-accent/40 px-4 py-6 text-center mb-1">
            <Upload className="h-6 w-6 text-accent mb-1.5" />
            <p className="text-xs font-medium text-accent">
              Drop files here to upload
            </p>
          </div>
        )}

        {tree.length === 0 && !creating && !isDraggingOver && (
          <div className="flex flex-col items-center justify-center px-4 py-8 text-center">
            <File className="h-8 w-8 text-text-muted mb-2" />
            <p className="text-xs text-text-muted">No files yet</p>
            <p className="text-xs text-text-muted mt-1">
              Drag files here or use the buttons above
            </p>
          </div>
        )}

        {tree.map((node) => (
          <TreeNodeItem
            key={node.path}
            node={node}
            depth={0}
            activeFileId={activeFileId}
            mainFilePath={mainFilePath}
            renamingFileId={renamingFileId}
            dropTargetPath={dropTargetPath}
            selectedFileIds={selectedFileIds}
            onFileSelect={onFileSelect}
            onFileClick={handleFileClick}
            onDeleteFile={handleDeleteFile}
            onContextMenu={handleContextMenu}
            onRenameSubmit={handleRenameSubmit}
            onRenameCancel={handleRenameCancel}
            onDragStartInternal={handleInternalDragStart}
            onDragEndInternal={handleInternalDragEnd}
            onDragOverFolder={handleDragOverFolder}
            onDropOnFolder={handleDropOnFolder}
          />
        ))}
      </div>

      {/* Context menu (hidden for viewers) */}
      {!readOnly && contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          selectedCount={selectedFileIds.has(contextMenu.file.id) ? selectedFileIds.size : 1}
          canSetEntrypoint={
            !contextMenu.file.isDirectory &&
            contextMenu.file.path.toLowerCase().endsWith(".tex")
          }
          isEntrypoint={contextMenu.file.path === mainFilePath}
          onSetEntrypoint={() => {
            handleSetEntrypoint(contextMenu.file.path);
            closeContextMenu();
          }}
          onDelete={() => {
            if (selectedFileIds.has(contextMenu.file.id) && selectedFileIds.size > 1) {
              setBulkDeleteConfirm(new Set(selectedFileIds));
            } else {
              handleDeleteFile(contextMenu.file.id);
            }
            closeContextMenu();
          }}
          onRename={() => {
            setRenamingFileId(contextMenu.file.id);
            closeContextMenu();
          }}
          onCopy={() => {
            const ids = selectedFileIds.has(contextMenu.file.id) && selectedFileIds.size > 1
              ? [...selectedFileIds]
              : [contextMenu.file.id];
            setCopiedFileIds(ids);
            closeContextMenu();
          }}
          onPaste={() => {
            handlePasteFiles();
            closeContextMenu();
          }}
          hasCopied={copiedFileIds.length > 0}
          onClose={closeContextMenu}
        />
      )}

      {/* Delete confirmation dialog */}
      <ConfirmDialog
        open={deleteConfirm !== null}
        title="Delete file"
        message="Are you sure you want to delete this file? This action cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteConfirm(null)}
      />

      {/* Bulk delete confirmation dialog */}
      <ConfirmDialog
        open={bulkDeleteConfirm !== null}
        title="Delete files"
        message={`Are you sure you want to delete ${bulkDeleteConfirm?.size ?? 0} file(s)? This action cannot be undone.`}
        confirmLabel="Delete All"
        variant="danger"
        onConfirm={confirmBulkDelete}
        onCancel={() => setBulkDeleteConfirm(null)}
      />

      {/* Alert dialog */}
      <ConfirmDialog
        open={alertMessage !== null}
        title="Error"
        message={alertMessage ?? ""}
        alert
        onConfirm={() => setAlertMessage(null)}
        onCancel={() => setAlertMessage(null)}
      />
    </div>
  );
}
