"use client";

import { useCallback } from "react";
import { cn } from "@/lib/utils/cn";
import { Sparkles, X } from "lucide-react";

// ─── Types ──────────────────────────────────────────

interface OpenFile {
  id: string;
  path: string;
}

interface EditorTabsProps {
  openFiles: OpenFile[];
  activeFileId: string | null;
  dirtyFileIds?: Set<string>;
  onSelectTab: (fileId: string) => void;
  onCloseTab: (fileId: string) => void;
  /** Pinned AI tab on the left. Always present when provided; it cannot be closed. */
  aiTab?: { active: boolean; onSelect: () => void };
}

// ─── Helpers ────────────────────────────────────────

function getFilename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1];
}

// One tab shell for files and for the AI tab, so the row reads as one strip.
// Active tab: content surface + a top hairline. Never a side stripe.
const TAB_BASE =
  "group relative flex h-full shrink-0 cursor-pointer select-none items-center " +
  "gap-1.5 border-r border-border-subtle pr-1.5 pl-3 " +
  "transition-colors duration-150 ease-out";

const TAB_ACTIVE = "bg-bg-primary text-text-primary";
const TAB_IDLE =
  "bg-bg-secondary text-text-muted hover:bg-bg-elevated hover:text-text-secondary";

// Close is revealed on hover but stays reachable by keyboard: it is always in
// the tab order, and focus inside the tab brings it back to full opacity.
const CLOSE_BUTTON =
  "relative grid h-4 w-4 shrink-0 place-items-center rounded-sm text-text-muted " +
  "transition-colors duration-150 ease-out hover:bg-bg-elevated hover:text-text-primary";

const CLOSE_ICON =
  "h-3 w-3 opacity-0 transition-opacity duration-150 ease-out " +
  "group-hover:opacity-100 group-focus-within:opacity-100";

// ─── EditorTabs ─────────────────────────────────────

export function EditorTabs({
  openFiles,
  activeFileId,
  dirtyFileIds,
  onSelectTab,
  onCloseTab,
  aiTab,
}: EditorTabsProps) {
  const handleMouseDown = useCallback(
    (e: React.MouseEvent, fileId: string) => {
      // Middle-click to close
      if (e.button === 1) {
        e.preventDefault();
        onCloseTab(fileId);
      }
    },
    [onCloseTab]
  );

  if (openFiles.length === 0 && !aiTab) {
    return <div className="h-9 border-b border-border bg-bg-secondary" />;
  }

  return (
    <div
      className={cn(
        "flex h-9 items-stretch overflow-hidden",
        "border-b border-border bg-bg-secondary"
      )}
    >
      {aiTab && (
        <div
          className={cn(
            TAB_BASE,
            "sticky left-0 z-10 border-r border-border",
            aiTab.active ? TAB_ACTIVE : TAB_IDLE
          )}
        >
          {aiTab.active && (
            <span
              aria-hidden
              className="absolute inset-x-0 top-0 h-0.5 bg-accent"
            />
          )}

          <button
            type="button"
            onClick={aiTab.onSelect}
            className="flex items-center gap-1.5 pr-1.5 text-xs"
            title="AI Assistant"
          >
            <Sparkles
              className={cn(
                "h-3 w-3",
                aiTab.active ? "text-accent" : "text-text-muted"
              )}
            />
            AI
          </button>
        </div>
      )}

      <div
        className={cn(
          "flex min-w-0 flex-1 items-stretch overflow-x-auto overflow-y-hidden",
          "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        )}
      >
      {openFiles.map((file) => {
        const isActive = !aiTab?.active && file.id === activeFileId;
        const isDirty = dirtyFileIds?.has(file.id) ?? false;
        const filename = getFilename(file.path);

        return (
          <div
            key={file.id}
            onMouseDown={(e) => handleMouseDown(e, file.id)}
            className={cn(TAB_BASE, isActive ? TAB_ACTIVE : TAB_IDLE)}
          >
            {/* Active indicator hairline */}
            {isActive && (
              <span
                aria-hidden
                className="absolute inset-x-0 top-0 h-0.5 bg-accent"
              />
            )}

            {/* Tab label */}
            <button
              type="button"
              onClick={() => onSelectTab(file.id)}
              className="max-w-[140px] truncate font-mono text-xs"
              title={file.path}
            >
              {filename}
            </button>

            {/* Dirty dot at rest, close on hover or keyboard focus */}
            <button
              type="button"
              aria-label={`Close ${filename}`}
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(file.id);
              }}
              className={CLOSE_BUTTON}
            >
              {isDirty && (
                <span
                  aria-hidden
                  className={cn(
                    "absolute h-1.5 w-1.5 rounded-full bg-text-secondary",
                    "transition-opacity duration-150 ease-out",
                    "group-hover:opacity-0 group-focus-within:opacity-0"
                  )}
                />
              )}
              <X aria-hidden className={CLOSE_ICON} />
            </button>
          </div>
        );
      })}
      </div>
    </div>
  );
}
