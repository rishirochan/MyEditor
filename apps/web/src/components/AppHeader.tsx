"use client";

import { useState, useEffect } from "react";
import { useTheme } from "@/components/ThemeProvider";
import { cn } from "@/lib/utils/cn";
import {
  User,
  Settings,
  LogOut,
  LayoutDashboard,
  Sun,
  Moon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";

// ─── Types ──────────────────────────────────────────

interface UserInfo {
  id: string;
  email: string;
  name: string;
}

interface AppHeaderProps {
  children?: React.ReactNode;
  leftContent?: React.ReactNode;
  className?: string;
}

// ─── Helpers ────────────────────────────────────────

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (parts.length === 0) return "";
  return parts.map((part) => part[0]).join("").toUpperCase();
}

// ─── AppHeader ──────────────────────────────────────

export function AppHeader({ children, leftContent, className }: AppHeaderProps) {
  const [user, setUser] = useState<UserInfo | null>(null);
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    async function fetchUser() {
      try {
        const res = await fetch("/api/auth/me");
        if (res.ok) {
          const data = await res.json();
          setUser(data.user);
        }
      } catch {
        // Silently fail
      }
    }
    fetchUser();
  }, []);

  async function handleLogout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      window.location.href = "/login";
    } catch {
      // Silently fail
    }
  }

  const initials = user ? initialsOf(user.name) : "";

  return (
    <TooltipProvider delayDuration={300}>
      <header
        className={cn(
          // Chrome, not content: one hairline, one shadow, no fill games.
          "relative z-30 flex h-11 shrink-0 items-center gap-2 border-b border-border",
          "bg-bg-secondary px-2.5 shadow-xs",
          className
        )}
      >
        {/* Left: wordmark + optional page content */}
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <a
            href="/dashboard"
            aria-label="MyEditor dashboard"
            className="group flex shrink-0 items-center gap-2 rounded-md"
          >
            <span
              aria-hidden
              className="flex h-6 w-6 items-center justify-center rounded-md border border-accent-muted bg-accent-subtle font-mono text-[13px] leading-none font-semibold text-accent transition-colors group-hover:border-accent"
            >
              {"\\"}
            </span>
            <span className="hidden font-mono text-[13px] font-semibold tracking-tight text-text-primary transition-colors group-hover:text-accent sm:inline">
              MyEditor
            </span>
          </a>
          {leftContent}
        </div>

        {/* Center: page-specific controls */}
        {children && (
          <div className="flex shrink-0 items-center gap-1.5">{children}</div>
        )}

        {/* Right: theme + account */}
        <div className="flex flex-1 items-center justify-end gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={toggleTheme}
                aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                className="btn btn-ghost h-7 w-7 rounded-md p-0 text-text-muted"
              >
                {theme === "dark" ? (
                  <Sun className="h-4 w-4" />
                ) : (
                  <Moon className="h-4 w-4" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent>
              {theme === "dark" ? "Light mode" : "Dark mode"}
            </TooltipContent>
          </Tooltip>

          <div aria-hidden className="mx-1 h-4 w-px bg-border-subtle" />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={user ? `Account: ${user.name}` : "Account"}
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full border border-border bg-bg-elevated",
                  "font-mono text-[11px] font-medium text-text-secondary",
                  "transition-colors hover:border-border-strong hover:text-text-primary",
                  "data-[state=open]:border-accent-muted data-[state=open]:bg-accent-subtle data-[state=open]:text-accent"
                )}
              >
                {initials || <User className="h-3.5 w-3.5" />}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              {user && (
                <>
                  <DropdownMenuLabel>
                    <div className="flex flex-col gap-0.5 py-0.5">
                      <span className="text-sm font-medium text-text-primary">
                        {user.name}
                      </span>
                      <span className="truncate font-mono text-xs text-text-muted">
                        {user.email}
                      </span>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem
                onClick={() => {
                  window.location.href = "/dashboard";
                }}
              >
                <LayoutDashboard className="h-4 w-4" />
                <span>Projects</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  window.location.href = "/dashboard/settings";
                }}
              >
                <Settings className="h-4 w-4" />
                <span>Settings</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout}>
                <LogOut className="h-4 w-4" />
                <span>Log out</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
    </TooltipProvider>
  );
}
