"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils/cn";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Info,
  Loader2,
  Ban,
  ChevronUp,
  ChevronDown,
  Sparkles,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────

interface LogError {
  type: string;
  file: string;
  line: number;
  message: string;
}

interface BuildLogsProps {
  logs: string;
  status: string;
  duration: number | null;
  errors: LogError[];
  actorName?: string | null;
  onErrorClick?: (file: string, line: number) => void;
  canFixWithAi?: boolean;
  fixingWithAi?: boolean;
  onFixWithAi?: () => void;
  aiExplanation?: string | null;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}

// ─── Helpers ────────────────────────────────────────

function getStatusIcon(status: string) {
  switch (status) {
    case "success":
      return <CheckCircle2 className="h-4 w-4 text-success" />;
    case "error":
    case "timeout":
      return <XCircle className="h-4 w-4 text-error" />;
    case "canceled":
      return <Ban className="h-4 w-4 text-text-muted" />;
    case "compiling":
    case "queued":
      return <Loader2 className="h-4 w-4 animate-spin text-warning" />;
    default:
      return <div className="h-4 w-4 rounded-full border-2 border-text-muted" />;
  }
}

function getStatusLabel(status: string): string {
  switch (status) {
    case "success":
      return "Build succeeded";
    case "error":
      return "Build failed";
    case "timeout":
      return "Build timed out";
    case "canceled":
      return "Build canceled";
    case "compiling":
      return "Compiling...";
    case "queued":
      return "Queued";
    default:
      return "No builds";
  }
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** error > warning > everything else, so the thing you must fix is on top. */
function severityRank(type: string): number {
  if (type === "error" || type === "fatal") return 0;
  if (type === "warning") return 1;
  return 2;
}

// ─── BuildLogs ──────────────────────────────────────

export function BuildLogs({
  logs,
  status,
  duration,
  errors,
  actorName = null,
  onErrorClick,
  canFixWithAi = false,
  fixingWithAi = false,
  onFixWithAi,
  aiExplanation = null,
  expanded,
  onExpandedChange,
}: BuildLogsProps) {
  const [internalExpanded, setInternalExpanded] = useState(true);
  const isControlled = typeof expanded === "boolean";
  const isExpanded = isControlled ? (expanded as boolean) : internalExpanded;

  const toggleExpanded = () => {
    const next = !isExpanded;
    if (!isControlled) {
      setInternalExpanded(next);
    }
    onExpandedChange?.(next);
  };

  const errorCount = errors.filter(
    (e) => e.type === "error" || e.type === "fatal"
  ).length;
  const warningCount = errors.filter((e) => e.type === "warning").length;

  // Presentation-only ordering; the underlying list is untouched.
  const sortedErrors = useMemo(
    () =>
      errors
        .map((entry, index) => ({ entry, index }))
        .sort(
          (a, b) =>
            severityRank(a.entry.type) - severityRank(b.entry.type) ||
            a.index - b.index
        ),
    [errors]
  );

  const cleanBuild = status === "success" && errors.length === 0;

  return (
    <div className="flex h-full flex-col bg-bg-secondary">
      {/* Header: status, counts, actions. Always visible. */}
      <div className="flex h-9 shrink-0 items-center justify-between gap-3 border-b border-border px-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {getStatusIcon(status)}
          <span className="truncate text-xs font-medium text-text-primary">
            {getStatusLabel(status)}
          </span>
          {actorName && (status === "queued" || status === "compiling") && (
            <span className="truncate text-xs text-text-muted">by {actorName}</span>
          )}

          {duration !== null && (
            <span className="text-xs text-text-muted" data-numeric>
              {formatDuration(duration)}
            </span>
          )}

          {errorCount > 0 && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-error-subtle px-1.5 py-0.5 text-[11px] font-medium text-error">
              <XCircle className="h-3 w-3" />
              <span data-numeric>{errorCount}</span>
              {errorCount === 1 ? "error" : "errors"}
            </span>
          )}

          {warningCount > 0 && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-warning">
              <AlertTriangle className="h-3 w-3" />
              <span data-numeric>{warningCount}</span>
              {warningCount === 1 ? "warning" : "warnings"}
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {canFixWithAi && onFixWithAi && (status === "error" || status === "timeout") && (
            <button
              type="button"
              onClick={onFixWithAi}
              disabled={fixingWithAi}
              className="btn btn-secondary gap-1 px-2 py-1 text-[11px]"
            >
              {fixingWithAi ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="h-3 w-3 text-accent" />
              )}
              {fixingWithAi ? "Fixing..." : "Fix with AI"}
            </button>
          )}
          <button
            type="button"
            onClick={toggleExpanded}
            aria-expanded={isExpanded}
            aria-label={isExpanded ? "Collapse build log" : "Expand build log"}
            className="rounded-md p-1 text-text-muted transition-colors duration-150 ease-out hover:bg-bg-elevated hover:text-text-primary"
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronUp className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className="min-h-0 flex-1 overflow-auto">
          {aiExplanation && (
            <div className="border-b border-border-subtle bg-accent-subtle px-3 py-2">
              <p className="text-[11px] font-medium uppercase tracking-wide text-accent">
                AI fix summary
              </p>
              <p className="mt-1 text-xs text-text-secondary">{aiExplanation}</p>
            </div>
          )}

          {/* Diagnostics, errors first */}
          {sortedErrors.length > 0 && (
            <div className="border-b border-border-subtle">
              {sortedErrors.map(({ entry: error, index }) => {
                const rank = severityRank(error.type);
                const isError = rank === 0;
                const isWarning = rank === 1;

                return (
                  <button
                    key={index}
                    type="button"
                    onClick={() => onErrorClick?.(error.file, error.line)}
                    className="group flex w-full items-start gap-2 border-b border-border-subtle px-3 py-1.5 text-left text-xs transition-colors duration-150 ease-out last:border-b-0 hover:bg-bg-elevated"
                  >
                    <span
                      className={cn(
                        "mt-0.5 inline-flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                        isError
                          ? "bg-error-subtle text-error"
                          : isWarning
                            ? "text-warning"
                            : "text-text-muted"
                      )}
                    >
                      {isError ? (
                        <XCircle className="h-3 w-3" />
                      ) : isWarning ? (
                        <AlertTriangle className="h-3 w-3" />
                      ) : (
                        <Info className="h-3 w-3" />
                      )}
                      {error.type}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          "block break-words",
                          isError
                            ? "text-text-primary"
                            : isWarning
                              ? "text-text-secondary"
                              : "text-text-muted"
                        )}
                      >
                        {error.message}
                      </span>
                      {error.file && (
                        <span
                          className="mt-0.5 inline-block font-mono text-[11px] text-text-muted underline decoration-transparent underline-offset-2 transition-colors duration-150 ease-out group-hover:text-text-secondary group-hover:decoration-border-strong"
                          data-numeric
                        >
                          {error.file}
                          {error.line > 0 ? `:${error.line}` : ""}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Raw log output */}
          {logs && (
            <div className="p-2">
              <p className="px-1 pb-1 text-[10px] font-medium uppercase tracking-wide text-text-muted">
                Raw output
              </p>
              <pre className="overflow-x-auto rounded-md bg-bg-inset p-3 font-mono text-[11px] leading-[1.7] whitespace-pre text-text-secondary">
                {logs}
              </pre>
            </div>
          )}

          {/* Empty states */}
          {!logs && errors.length === 0 && (
            <div className="flex flex-col items-start gap-1 px-3 py-5">
              {cleanBuild ? (
                <>
                  <span className="flex items-center gap-2 text-xs font-medium text-success">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Nothing to report
                  </span>
                  <p className="text-xs text-text-muted">
                    The build finished with no errors and no warnings.
                  </p>
                </>
              ) : (
                <>
                  <span className="text-xs font-medium text-text-secondary">
                    No build output
                  </span>
                  <p className="text-xs text-text-muted">
                    Compile the project to see the log here.
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
