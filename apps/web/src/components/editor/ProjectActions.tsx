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

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={handleDownloadZip}
            aria-label="Download source ZIP"
            className="rounded p-1 text-text-muted transition-colors hover:text-text-primary hover:bg-bg-elevated"
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
                className="rounded p-1 text-text-muted transition-colors hover:text-accent hover:bg-bg-elevated"
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
