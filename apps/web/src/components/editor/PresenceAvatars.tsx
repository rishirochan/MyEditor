"use client";

import { cn } from "@/lib/utils/cn";
import { Eye } from "lucide-react";
import type { PresenceUser } from "@myeditor/shared";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";

// ─── Types ──────────────────────────────────────────

interface PresenceAvatarsProps {
  users: PresenceUser[];
  currentUserId: string;
  maxVisible?: number;
  followingUserId?: string | null;
  onFollowUser?: (userId: string) => void;
}

// Collaborator hues are assigned at runtime, so the fill stays inline. The
// ink on top of it must not: every presence colour is a light pastel, so the
// label takes the dark end of whichever theme is active.
const AVATAR_INK = "text-ink-on-hue";

// ─── PresenceAvatars ────────────────────────────────

export function PresenceAvatars({
  users,
  currentUserId,
  maxVisible = 5,
  followingUserId,
  onFollowUser,
}: PresenceAvatarsProps) {
  // Filter out current user, show others
  const others = users.filter((u) => u.userId !== currentUserId);

  if (others.length === 0) return null;

  const visible = others.slice(0, maxVisible);
  const overflow = others.length - maxVisible;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex items-center -space-x-1.5">
        {visible.map((user) => {
          const isFollowing = followingUserId === user.userId;
          return (
            <Tooltip key={user.userId}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-pressed={isFollowing}
                  aria-label={
                    isFollowing
                      ? `Stop following ${user.name}`
                      : `Follow ${user.name}`
                  }
                  className={cn(
                    "relative flex h-6 w-6 items-center justify-center rounded-full text-[11px]",
                    "font-semibold ring-2 transition-[transform,box-shadow] duration-150",
                    "ease-out hover:z-10 hover:scale-110",
                    AVATAR_INK,
                    isFollowing
                      ? "z-10 scale-110 ring-accent"
                      : "ring-bg-secondary"
                  )}
                  style={{ backgroundColor: user.color }}
                  onClick={() => onFollowUser?.(user.userId)}
                >
                  {user.name.charAt(0).toUpperCase()}
                  {/* Follow state never rides on colour alone. */}
                  {isFollowing && (
                    <span
                      aria-hidden
                      className="absolute -right-0.5 -bottom-0.5 grid h-3 w-3 place-items-center rounded-full bg-accent text-accent-fg ring-2 ring-bg-secondary"
                    >
                      <Eye className="h-2 w-2" />
                    </span>
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <div className="text-xs">
                  <p className="font-medium">
                    {user.name}
                    {isFollowing && (
                      <span className="ml-1 text-accent">(Following)</span>
                    )}
                  </p>
                  {user.activeFilePath && (
                    <p className="mt-0.5 font-mono text-text-muted">
                      Viewing {user.activeFilePath}
                    </p>
                  )}
                  <p className="mt-0.5 text-text-muted">
                    {isFollowing ? "Click to unfollow" : "Click to follow"}
                  </p>
                </div>
              </TooltipContent>
            </Tooltip>
          );
        })}

        {overflow > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex h-6 w-6 cursor-default items-center justify-center rounded-full bg-bg-elevated text-[10px] font-semibold text-text-secondary ring-2 ring-bg-secondary">
                +{overflow}
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <div className="text-xs">
                {others.slice(maxVisible).map((u) => (
                  <p key={u.userId}>{u.name}</p>
                ))}
              </div>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </TooltipProvider>
  );
}
