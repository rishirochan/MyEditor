"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { EditorLayout } from "@/components/editor/EditorLayout";

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

interface ProjectData {
  project: Project;
  files: ProjectFile[];
  lastBuild: Build | null;
  role?: "owner" | "viewer" | "editor";
}

interface CurrentUser {
  id: string;
  email: string;
  name: string;
}

// ─── Editor Page ────────────────────────────────────

export default function EditorPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);

  const [data, setData] = useState<ProjectData | null>(null);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    async function fetchData() {
      try {
        const [projectRes, userRes] = await Promise.all([
          fetch(`/api/projects/${projectId}`, { cache: "no-store" }),
          fetch("/api/auth/me", { cache: "no-store" }),
        ]);

        if (!projectRes.ok) {
          setError(true);
          return;
        }

        const json = await projectRes.json();
        setData(json);

        if (userRes.ok) {
          const userData = await userRes.json();
          setCurrentUser(userData.user);
        }
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [projectId]);

  // Loading state
  if (loading) {
    return (
      <div
        aria-busy="true"
        className="flex h-full w-full flex-col overflow-hidden bg-bg-tertiary"
      >
        <span className="sr-only">Loading project</span>
        <div className="flex h-10 shrink-0 items-center gap-3 border-b border-border bg-bg-secondary px-3">
          <div className="h-3 w-20 animate-pulse-soft rounded bg-bg-elevated" />
          <div className="h-3 w-28 animate-pulse-soft rounded bg-bg-elevated" />
          <div className="ml-auto h-5 w-16 animate-pulse-soft rounded-md bg-bg-elevated" />
        </div>

        <div className="flex min-h-0 flex-1 gap-px bg-bg-tertiary">
          {/* file tree */}
          <div className="hidden w-56 shrink-0 flex-col gap-2.5 bg-bg-secondary p-3 sm:flex">
            {[64, 88, 72, 96, 56, 80].map((w, i) => (
              <div
                key={i}
                className="h-2.5 animate-pulse-soft rounded bg-bg-elevated"
                style={{ width: w }}
              />
            ))}
          </div>

          {/* source */}
          <div className="flex min-w-0 flex-1 flex-col gap-2.5 bg-bg-primary p-4">
            {[70, 45, 88, 60, 78, 38, 66, 52].map((w, i) => (
              <div
                key={i}
                className="h-2.5 animate-pulse-soft rounded bg-bg-elevated"
                style={{ width: `${w}%` }}
              />
            ))}
          </div>

          {/* preview */}
          <div className="hidden min-w-0 flex-1 items-start justify-center bg-bg-primary p-6 lg:flex">
            <div className="h-full w-full max-w-[420px] animate-pulse-soft rounded-sm bg-bg-elevated" />
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (error || !data) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-bg-tertiary p-6">
        <div className="panel flex w-full max-w-sm flex-col items-start gap-3 p-6 shadow-md">
          <span className="inline-flex items-center gap-2 font-mono text-xs text-text-muted">
            <FileQuestion className="h-4 w-4" />
            404
          </span>
          <h2 className="text-base font-semibold text-text-primary">
            Project not found
          </h2>
          <p className="text-sm text-text-secondary">
            This project does not exist, or your account does not have access to
            it.
          </p>
          <Link href="/dashboard" className="btn btn-primary mt-1">
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <EditorLayout
      project={data.project}
      files={data.files}
      lastBuild={data.lastBuild}
      role={data.role ?? "owner"}
      currentUser={currentUser ?? { id: "", email: "", name: "" }}
    />
  );
}
