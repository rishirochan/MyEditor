"use client";

import { useState } from "react";
import { Share2, FileArchive } from "lucide-react";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { ShareDialog } from "@/components/editor/ShareDialog";

interface ProjectActionsProps {
  projectId: string;
  projectName: string;
  isOwner: boolean;
  canManageShare: boolean;
  shareToken?: string | null;
  onShareUpdated?: () => void;
}

/** Share + source ZIP actions, rendered at the end of the preview toolbar. */
export function ProjectActions({
  projectId,
  projectName,
  isOwner,
  canManageShare,
  shareToken = null,
  onShareUpdated,
}: ProjectActionsProps) {
  const [shareOpen, setShareOpen] = useState(false);

  function handleDownloadZip() {
    const url = `/api/projects/${projectId}/download`;
    window.open(
      shareToken ? `${url}?share=${encodeURIComponent(shareToken)}` : url,
      "_blank"
    );
  }

  // Same icon-button vocabulary as the rest of the preview toolbar it sits in.
  const iconButton =
    "rounded-md p-1 text-text-muted transition-colors duration-150 ease-out " +
    "hover:bg-bg-elevated hover:text-text-primary";

  return (
    <>
      {/* Project-level actions are their own group, not more toolbar icons. */}
      <div className="mx-1 h-4 w-px shrink-0 bg-border-subtle" />

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={handleDownloadZip}
            aria-label="Download source ZIP"
            className={iconButton}
          >
            <FileArchive className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent>Download source ZIP</TooltipContent>
      </Tooltip>

      {canManageShare && (
        <>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setShareOpen(true)}
                aria-label="Share project"
                className={iconButton}
              >
                <Share2 className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Share project</TooltipContent>
          </Tooltip>

          <ShareDialog
            projectId={projectId}
            projectName={projectName}
            open={shareOpen}
            onClose={() => setShareOpen(false)}
            isOwner={isOwner}
            onChanged={onShareUpdated}
          />
        </>
      )}
    </>
  );
}
