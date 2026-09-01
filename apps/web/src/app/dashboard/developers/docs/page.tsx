"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils/cn";
import {
  Copy,
  Check,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ArrowLeft,
  Zap,
  FolderOpen,
  FileText,
  Upload,
  Hammer,
  Download,
  ListOrdered,
  Tag,
  Sparkles,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────

interface Endpoint {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  description: string;
  auth: boolean;
  body?: Record<string, FieldDoc>;
  query?: Record<string, FieldDoc>;
  response?: string;
  curl?: string;
  notes?: string;
}

interface FieldDoc {
  type: string;
  required: boolean;
  description: string;
}

interface EndpointSection {
  title: string;
  icon: React.ReactNode;
  description: string;
  endpoints: Endpoint[];
}

// ─── Method Badge ───────────────────────────────────

/* The method word is the label; the tint only reinforces it, so the
   badge still reads correctly in greyscale. Fixed width keeps every
   path in a section aligned on one column. */
const METHOD_TONES: Record<string, string> = {
  GET: "bg-accent-subtle text-accent",
  POST: "bg-success-subtle text-success",
  PUT: "bg-warning-subtle text-warning",
  DELETE: "bg-error-subtle text-error",
};

function MethodBadge({ method }: { method: string }) {
  return (
    <span
      className={cn(
        "inline-flex w-[3.5rem] shrink-0 justify-center rounded border border-border-subtle px-1.5 py-0.5 font-mono text-[11px] font-semibold tracking-wide",
        METHOD_TONES[method] || "bg-bg-elevated text-text-muted"
      )}
    >
      {method}
    </span>
  );
}

// ─── Copy Button ────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="absolute top-2 right-2 z-10 inline-flex items-center gap-1 rounded-md border border-border-subtle bg-bg-elevated px-2 py-1 text-[11px] font-medium text-text-secondary transition-colors duration-150 hover:border-border-strong hover:text-text-primary"
      title="Copy"
    >
      {copied ? (
        <>
          <Check className="h-3 w-3 text-success" />
          Copied
        </>
      ) : (
        <>
          <Copy className="h-3 w-3" />
          Copy
        </>
      )}
    </button>
  );
}

/* Code reads as code: recessed surface, hairline, mono, room to
   breathe, and it scrolls sideways rather than wrapping a curl line. */
function CodeBlock({ code, copyable = true }: { code: string; copyable?: boolean }) {
  return (
    <div className="relative">
      {copyable && <CopyButton text={code} />}
      <pre className="overflow-x-auto rounded-lg border border-border-subtle bg-bg-inset p-3 pr-16 font-mono text-xs leading-relaxed whitespace-pre text-text-secondary">
        {code}
      </pre>
    </div>
  );
}

function FieldTable({
  columns,
  children,
}: {
  columns: string[];
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border-subtle">
      <table className="w-full min-w-[34rem] text-sm">
        <thead>
          <tr className="bg-bg-inset text-text-secondary">
            {columns.map((column) => (
              <th
                key={column}
                className="px-3 py-2 text-left text-[11px] font-medium tracking-wide uppercase"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function DocLabel({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="mb-2 text-xs font-medium tracking-wide text-text-muted uppercase">
      {children}
    </h4>
  );
}

// ─── Endpoint Card ──────────────────────────────────

function EndpointCard({ endpoint }: { endpoint: Endpoint }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="panel overflow-hidden">
      {/* Header */}
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors duration-150 hover:bg-bg-elevated"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-text-muted" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-text-muted" />
        )}
        <MethodBadge method={endpoint.method} />
        <code className="truncate font-mono text-sm text-text-primary">
          {endpoint.path}
        </code>
        <span className="ml-auto hidden max-w-[32ch] truncate text-xs text-text-muted lg:inline">
          {endpoint.description}
        </span>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="space-y-5 border-t border-border-subtle px-4 py-4">
          <p className="max-w-[70ch] text-sm text-text-secondary">
            {endpoint.description}
          </p>

          {endpoint.notes && (
            <p className="flex max-w-[70ch] items-start gap-2 rounded-lg bg-warning-subtle px-3 py-2.5 text-sm text-warning">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{endpoint.notes}</span>
            </p>
          )}

          {/* Request body */}
          {endpoint.body && (
            <div>
              <DocLabel>Request body (JSON)</DocLabel>
              <FieldTable columns={["Field", "Type", "Required", "Description"]}>
                {Object.entries(endpoint.body).map(([name, field]) => (
                  <tr key={name} className="border-t border-border-subtle">
                    <td className="px-3 py-2 font-mono text-xs text-text-primary">
                      {name}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-text-muted">
                      {field.type}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {field.required ? (
                        <span className="font-medium text-text-primary">
                          Required
                        </span>
                      ) : (
                        <span className="text-text-muted">Optional</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-text-secondary">
                      {field.description}
                    </td>
                  </tr>
                ))}
              </FieldTable>
            </div>
          )}

          {/* Query params */}
          {endpoint.query && (
            <div>
              <DocLabel>Query parameters</DocLabel>
              <FieldTable columns={["Param", "Type", "Description"]}>
                {Object.entries(endpoint.query).map(([name, field]) => (
                  <tr key={name} className="border-t border-border-subtle">
                    <td className="px-3 py-2 font-mono text-xs text-text-primary">
                      {name}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-text-muted">
                      {field.type}
                    </td>
                    <td className="px-3 py-2 text-xs text-text-secondary">
                      {field.description}
                    </td>
                  </tr>
                ))}
              </FieldTable>
            </div>
          )}

          {/* Response */}
          {endpoint.response && (
            <div>
              <DocLabel>Response</DocLabel>
              <CodeBlock code={endpoint.response} />
            </div>
          )}

          {/* cURL example */}
          {endpoint.curl && (
            <div>
              <DocLabel>Example request</DocLabel>
              <CodeBlock code={endpoint.curl} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Endpoint Sections Data ─────────────────────────

function getSections(origin: string): EndpointSection[] {
  const BASE = `${origin}/api/v1`;
  const APP_BASE = `${origin}/api`;

  return [
  {
    title: "One-Shot Compilation",
    icon: <Zap className="h-5 w-5" />,
    description:
      "Async compile API for raw LaTeX input. Submit a job, poll status, then fetch output.",
    endpoints: [
      {
        method: "POST",
        path: `${BASE}/compile`,
        description:
          "Submit an async one-shot compile job. Accepts multipart/form-data or JSON body.",
        auth: true,
        body: {
          file: {
            type: "file (.tex)",
            required: false,
            description:
              "A .tex file to compile (multipart/form-data). Use this OR JSON 'source'.",
          },
          source: {
            type: "string",
            required: false,
            description:
              "LaTeX source as a string (JSON body). Use this OR multipart 'file'. Max 5 MB.",
          },
          engine: {
            type: "string",
            required: false,
            description:
              'Engine: "auto", "pdflatex", "xelatex", "lualatex", "latex". Default: "auto".',
            },
        },
        query: {
          engine: {
            type: "string",
            required: false,
            description:
              'Override engine via query param. Same options as body field.',
          },
        },
        response: `{
  "jobId": "uuid",
  "status": "queued",
  "message": "Compilation queued",
  "pollUrl": "/api/v1/compile/uuid",
  "outputUrl": "/api/v1/compile/uuid/output",
  "cancelUrl": "/api/v1/compile/uuid/cancel"
}`,
        curl: `# Submit compile job
curl -X POST ${BASE}/compile \\
  -H "Authorization: Bearer bs_YOUR_API_KEY" \\
  -F "file=@document.tex" \\
  -F "engine=auto"

# JSON body also supported
curl -X POST ${BASE}/compile \\
  -H "Authorization: Bearer bs_YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"source": "\\\\documentclass{article}\\n\\\\begin{document}\\nHello!\\n\\\\end{document}"}'`,
        notes:
          "This endpoint is asynchronous by design. Use the returned job URLs to poll and fetch output.",
      },
      {
        method: "GET",
        path: `${BASE}/compile/:jobId`,
        description:
          "Get compile job status, summary counters, and output links.",
        auth: true,
        response: `{
  "job": {
    "id": "uuid",
    "status": "compiling",
    "requestedEngine": "auto",
    "engineUsed": null,
    "warningCount": 0,
    "errorCount": 0,
    "durationMs": null,
    "exitCode": null,
    "message": null,
    "createdAt": "2026-01-01T00:00:00Z",
    "startedAt": "2026-01-01T00:00:01Z",
    "completedAt": null,
    "expiresAt": null
  },
  "links": {
    "output": "/api/v1/compile/uuid/output",
    "pdf": null
  }
}`,
        curl: `curl ${BASE}/compile/JOB_ID \\
  -H "Authorization: Bearer bs_YOUR_API_KEY"`,
      },
      {
        method: "GET",
        path: `${BASE}/compile/:jobId/output`,
        description:
          "Fetch compile output after completion. Supports JSON/base64 or raw PDF.",
        auth: true,
        query: {
          format: {
            type: "string",
            required: false,
            description:
              '"json" (default) or "base64" returns JSON with base64 PDF + logs/errors. "pdf" returns binary application/pdf.',
          },
        },
        response: `# Success (format=json or base64):
{
  "pdf": "JVBERi0xLjQK... (base64)",
  "engineUsed": "pdflatex",
  "logs": "This is pdfTeX, Version 3.14...",
  "errors": [],
  "durationMs": 3200
}

# Error / timeout / canceled:
{
  "error": "Compilation failed",
  "status": "error",
  "engineUsed": "pdflatex",
  "logs": "...",
  "errors": [ ... ],
  "durationMs": 1200
}`,
        curl: `# JSON output
curl "${BASE}/compile/JOB_ID/output?format=json" \\
  -H "Authorization: Bearer bs_YOUR_API_KEY" \\
  -o output.json

# Raw PDF
curl "${BASE}/compile/JOB_ID/output?format=pdf" \\
  -H "Authorization: Bearer bs_YOUR_API_KEY" \\
  --output output.pdf`,
      },
      {
        method: "POST",
        path: `${BASE}/compile/:jobId/cancel`,
        description:
          "Cancel an in-progress async compile job.",
        auth: true,
        response: `{
  "jobId": "uuid",
  "status": "canceled",
  "message": "Cancel request accepted"
}`,
        curl: `curl -X POST ${BASE}/compile/JOB_ID/cancel \\
  -H "Authorization: Bearer bs_YOUR_API_KEY"`,
      },

    ],
  },
  {
    title: "Projects",
    icon: <FolderOpen className="h-5 w-5" />,
    description: "Create, list, update, and delete LaTeX projects.",
    endpoints: [
      {
        method: "GET",
        path: `${BASE}/projects`,
        description: "List all projects for the authenticated user.",
        auth: true,
        response: `{
  "projects": [
    {
      "id": "uuid",
      "name": "My Paper",
      "description": "A research paper",
      "engine": "auto",
      "mainFile": "main.tex",
      "lastBuildStatus": "success",
      "createdAt": "2025-01-01T00:00:00Z",
      "updatedAt": "2025-01-01T00:00:00Z"
    }
  ]
}`,
        curl: `curl ${BASE}/projects \\
  -H "Authorization: Bearer bs_YOUR_API_KEY"`,
      },
      {
        method: "POST",
        path: `${BASE}/projects`,
        description: "Create a new project from a template.",
        auth: true,
        body: {
          name: {
            type: "string",
            required: true,
            description: "Project name (1-255 characters).",
          },
          description: {
            type: "string",
            required: false,
            description: "Optional project description.",
          },
          template: {
            type: "string",
            required: false,
            description:
              'Template: "blank", "article", "thesis", "beamer", "letter". Default: "blank".',
          },
          engine: {
            type: "string",
            required: false,
            description:
              'Project default engine: "auto", "pdflatex", "xelatex", "lualatex", or "latex". Default: "auto".',
          },
        },
        response: `{
  "project": {
    "id": "uuid",
    "name": "My Paper",
    "engine": "auto",
    "mainFile": "main.tex",
    "createdAt": "2025-01-01T00:00:00Z"
  }
}`,
        curl: `curl -X POST ${BASE}/projects \\
  -H "Authorization: Bearer bs_YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"name": "My Paper", "template": "article"}'`,
      },
      {
        method: "GET",
        path: `${BASE}/projects/:projectId`,
        description:
          "Get a project's details including files and latest build.",
        auth: true,
        response: `{
  "project": { "id": "uuid", "name": "My Paper", ... },
  "files": [
    { "id": "uuid", "path": "main.tex", "mimeType": "text/x-tex", ... }
  ],
  "lastBuild": {
    "id": "uuid", "status": "success", "durationMs": 2500, ...
  }
}`,
        curl: `curl ${BASE}/projects/PROJECT_ID \\
  -H "Authorization: Bearer bs_YOUR_API_KEY"`,
      },
      {
        method: "PUT",
        path: `${BASE}/projects/:projectId`,
        description: "Update project settings (name, engine, main file).",
        auth: true,
        body: {
          name: {
            type: "string",
            required: false,
            description: "New project name (1-255 characters).",
          },
          description: {
            type: "string",
            required: false,
            description: "New project description (max 1000 characters).",
          },
          engine: {
            type: "string",
            required: false,
            description:
              '"auto", "pdflatex", "xelatex", "lualatex", or "latex".',
          },
          mainFile: {
            type: "string",
            required: false,
            description: "Path to the main .tex file (max 500 characters).",
          },
        },
        curl: `curl -X PUT ${BASE}/projects/PROJECT_ID \\
  -H "Authorization: Bearer bs_YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"name": "Renamed Paper", "engine": "xelatex"}'`,
      },
      {
        method: "DELETE",
        path: `${BASE}/projects/:projectId`,
        description:
          "Delete a project and all its files permanently.",
        auth: true,
        curl: `curl -X DELETE ${BASE}/projects/PROJECT_ID \\
  -H "Authorization: Bearer bs_YOUR_API_KEY"`,
      },
    ],
  },
  {
  title: "Labels",
  icon: <Tag className="h-5 w-5" />,
  description: "Create, list, attach, and detach labels for organizing projects.",
  endpoints: [
    // ────────────────────────────────────────────────────────────────
    {
      method: "GET",
      path: `${BASE}/labels`,
      description: "List all labels for the authenticated user.",
      auth: true,
      response: `{
  "labels": [
    {
      "id": "uuid",
      "name": "Important",
      "userId": "uuid",
      "createdAt": "2025-01-01T00:00:00Z"
    }
  ]
}`,
      curl: `curl ${BASE}/labels \\
  -H "Authorization: Bearer bs_YOUR_API_KEY"`,
    },

    // ────────────────────────────────────────────────────────────────
    {
      method: "PUT",
      path: `${BASE}/labels/attach`,
      description:
        "Attach a label to a project by name. Creates the label if it does not already exist.",
      auth: true,
      body: {
        projectId: {
          type: "string",
          required: true,
          description: "The ID of the project to attach the label to.",
        },
        labelName: {
          type: "string",
          required: true,
          description: "The label name. If it doesn't exist, it will be created.",
        },
      },
      response: `{
  "projectLabel": {
    "id": "uuid",
    "projectId": "uuid",
    "labelId": "uuid"
  },
  "label": {
    "id": "uuid",
    "name": "Important",
    "userId": "uuid"
  }
}`,
      curl: `curl -X PUT ${BASE}/labels/attach \\
  -H "Authorization: Bearer bs_YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"projectId": "PROJECT_ID", "labelName": "Important"}'`,
    },

    // ────────────────────────────────────────────────────────────────
    {
      method: "PUT",
      path: `${BASE}/labels/detach`,
      description:
        "Detach a label from a project. If the label is no longer used by any project, it is deleted.",
      auth: true,
      body: {
        projectId: {
          type: "string",
          required: true,
          description: "The ID of the project to detach the label from.",
        },
        labelId: {
          type: "string",
          required: true,
          description: "The ID of the label to detach.",
        },
      },
      response: `{
  "id": "uuid",
  "projectId": "uuid",
  "labelId": "uuid",
  "deletedLabel": true
}`,
      curl: `curl -X PUT ${BASE}/labels/detach \\
  -H "Authorization: Bearer bs_YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"projectId": "PROJECT_ID", "labelId": "LABEL_ID"}'`,
    },
  ],
},

  {
    title: "Files",
    icon: <FileText className="h-5 w-5" />,
    description: "Manage files within a project.",
    endpoints: [
      {
        method: "GET",
        path: `${BASE}/projects/:projectId/files`,
        description: "List all files in a project.",
        auth: true,
        response: `{
  "files": [
    {
      "id": "uuid",
      "path": "main.tex",
      "mimeType": "text/x-tex",
      "size": 1234,
      "createdAt": "2025-01-01T00:00:00Z"
    }
  ]
}`,
        curl: `curl ${BASE}/projects/PROJECT_ID/files \\
  -H "Authorization: Bearer bs_YOUR_API_KEY"`,
      },
      {
        method: "POST",
        path: `${BASE}/projects/:projectId/files`,
        description: "Create a new file in the project.",
        auth: true,
        body: {
          path: {
            type: "string",
            required: true,
            description:
              'File path relative to project root (e.g. "chapters/intro.tex").',
          },
          content: {
            type: "string",
            required: false,
            description: "File content. Default: empty string. Ignored if isDirectory is true.",
          },
          isDirectory: {
            type: "boolean",
            required: false,
            description: "Set to true to create a directory instead of a file.",
          },
        },
        curl: `curl -X POST ${BASE}/projects/PROJECT_ID/files \\
  -H "Authorization: Bearer bs_YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"path": "chapters/intro.tex", "content": "\\\\chapter{Introduction}\\n"}'`,
      },
      {
        method: "GET",
        path: `${BASE}/projects/:projectId/files/:fileId`,
        description: "Get file metadata and content.",
        auth: true,
        response: `{
  "file": {
    "id": "uuid",
    "path": "main.tex",
    "mimeType": "text/x-tex",
    "size": 1234,
    "createdAt": "2025-01-01T00:00:00Z"
  },
  "content": "\\\\documentclass{article}..."
}`,
        curl: `curl ${BASE}/projects/PROJECT_ID/files/FILE_ID \\
  -H "Authorization: Bearer bs_YOUR_API_KEY"`,
      },
      {
        method: "PUT",
        path: `${BASE}/projects/:projectId/files/:fileId`,
        description: "Update a file's content.",
        auth: true,
        body: {
          content: {
            type: "string",
            required: true,
            description: "New file content.",
          },
        },
        curl: `curl -X PUT ${BASE}/projects/PROJECT_ID/files/FILE_ID \\
  -H "Authorization: Bearer bs_YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"content": "\\\\documentclass{article}\\n\\\\begin{document}\\nUpdated!\\n\\\\end{document}"}'`,
      },
      {
        method: "DELETE",
        path: `${BASE}/projects/:projectId/files/:fileId`,
        description: "Delete a file from the project.",
        auth: true,
        curl: `curl -X DELETE ${BASE}/projects/PROJECT_ID/files/FILE_ID \\
  -H "Authorization: Bearer bs_YOUR_API_KEY"`,
      },
    ],
  },
  {
    title: "File Upload",
    icon: <Upload className="h-5 w-5" />,
    description: "Upload files via multipart form data.",
    endpoints: [
      {
        method: "POST",
        path: `${BASE}/projects/:projectId/files/upload`,
        description:
          "Upload one or more files via FormData. Supports images, .bib, .tex, .sty, etc.",
        auth: true,
        notes:
          'Send as multipart/form-data with "files[]" field for each file and "paths[]" field for the corresponding file path. If a file already exists at the path, it will be overwritten.',
        response: `{
  "files": [
    { "id": "uuid", "path": "images/figure1.png", "mimeType": "image/png", "size": 45000 }
  ]
}`,
        curl: `curl -X POST ${BASE}/projects/PROJECT_ID/files/upload \\
  -H "Authorization: Bearer bs_YOUR_API_KEY" \\
  -F "files[]=@figure1.png" \\
  -F "paths[]=images/figure1.png" \\
  -F "files[]=@refs.bib" \\
  -F "paths[]=references.bib"`,
      },
    ],
  },
  {
    title: "Compilation",
    icon: <Hammer className="h-5 w-5" />,
    description:
      "Trigger compilation of a project and check build status.",
    endpoints: [
      {
        method: "POST",
        path: `${BASE}/projects/:projectId/compile`,
        description:
          "Queue a compilation of the project. Returns the queued build id.",
        auth: true,
        body: {
          engine: {
            type: "string",
            required: false,
            description:
              'Optional one-time engine override for this build. Does not change the project default engine.',
          },
        },
        response: `{
  "buildId": "uuid",
  "status": "queued",
  "message": "Compilation queued"
}`,
        curl: `curl -X POST ${BASE}/projects/PROJECT_ID/compile \\
  -H "Authorization: Bearer bs_YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"engine": "auto"}'`,
      },
    ],
  },
  {
    title: "PDF Download",
    icon: <Download className="h-5 w-5" />,
    description: "Download the compiled PDF from a project.",
    endpoints: [
      {
        method: "GET",
        path: `${BASE}/projects/:projectId/pdf`,
        description:
          "Download the latest compiled PDF. Returns the raw binary PDF.",
        auth: true,
        notes:
          "Returns `application/pdf` content type. The project must have a successful build.",
        curl: `curl -o output.pdf ${BASE}/projects/PROJECT_ID/pdf \\
  -H "Authorization: Bearer bs_YOUR_API_KEY"`,
      },
    ],
  },
  {
    title: "Build Logs",
    icon: <ListOrdered className="h-5 w-5" />,
    description: "Retrieve build status and parsed LaTeX logs.",
    endpoints: [
      {
        method: "GET",
        path: `${BASE}/projects/:projectId/builds`,
        description:
          "Get the latest build with status, logs, and parsed errors.",
        auth: true,
        response: `{
  "build": {
    "id": "uuid",
    "status": "success",
    "engine": "pdflatex",
    "logs": "This is pdfTeX, Version 3.14...",
    "durationMs": 2500,
    "createdAt": "2025-01-01T00:00:00Z"
  },
  "errors": [
    {
      "type": "error",
      "message": "Undefined control sequence",
      "line": 42,
      "file": "main.tex"
    }
  ]
}`,
        curl: `curl ${BASE}/projects/PROJECT_ID/builds \\
  -H "Authorization: Bearer bs_YOUR_API_KEY"`,
      },
    ],
  },
  {
    title: "AI Assistant (Session)",
    icon: <Sparkles className="h-5 w-5" />,
    description:
      "Dashboard-only AI endpoints for per-user model settings and build fixes. These use session auth, not API keys.",
    endpoints: [
      {
        method: "GET",
        path: `${APP_BASE}/ai/settings`,
        description: "Get current AI settings for the signed-in user.",
        auth: true,
        response: `{
  "settings": {
    "enabled": true,
    "buildFix": {
      "provider": "openai",
      "model": "gpt-4o-mini",
      "endpoint": null,
      "apiKeySet": true
    },
    "latexWriter": {
      "provider": "openai",
      "model": "gpt-4o-mini",
      "endpoint": null,
      "apiKeySet": false
    }
  }
}`,
        notes:
          "Requires a signed-in dashboard session cookie. API key auth is not supported for this endpoint.",
      },
      {
        method: "PUT",
        path: `${APP_BASE}/ai/settings`,
        description:
          "Update AI enabled flag and model/provider config for build fixes and LaTeX writing.",
        auth: true,
        body: {
          enabled: {
            type: "boolean",
            required: false,
            description:
              "Enable/disable AI features for this account. If false, AI fix endpoint returns 403.",
          },
          buildFix: {
            type: "object",
            required: true,
            description:
              "Model config used by Fix with AI in build logs (provider, model, optional endpoint/apiKey).",
          },
          latexWriter: {
            type: "object",
            required: true,
            description:
              "Model config used for LaTeX writing assistance (provider, model, optional endpoint/apiKey).",
          },
        },
        curl: `curl -X PUT ${APP_BASE}/ai/settings \\
  -H "Content-Type: application/json" \\
  -d '{
    "enabled": true,
    "buildFix": { "provider": "openai", "model": "gpt-4o-mini", "endpoint": null },
    "latexWriter": { "provider": "anthropic", "model": "claude-3-5-sonnet-latest", "endpoint": null }
  }'`,
        notes:
          "Provider options: openai, openrouter, anthropic, custom, claude-cli, codex-cli. Custom provider requires endpoint. claude-cli/codex-cli use local CLI logins on the server machine (no API key).",
      },
    ],
  },
  ];
}

// ─── Table of Contents ──────────────────────────────

/** Same slug the sections render, so the anchors always line up. */
function sectionId(title: string): string {
  return title.toLowerCase().replace(/\s+/g, "-");
}

const STATIC_SECTIONS = [
  { id: "authentication", title: "Authentication" },
  { id: "errors", title: "Error handling" },
];

const ERROR_CODES: { code: string; meaning: string }[] = [
  { code: "200", meaning: "Success" },
  { code: "201", meaning: "Resource created" },
  { code: "202", meaning: "Accepted, async job queued (compilation)" },
  { code: "400", meaning: "Bad request, invalid input or validation error" },
  { code: "401", meaning: "Unauthorized, missing or invalid API key" },
  { code: "403", meaning: "Forbidden, API key expired" },
  { code: "404", meaning: "Not found, resource does not exist or is not yours" },
  { code: "409", meaning: "Conflict, resource already exists (duplicate file path)" },
  { code: "422", meaning: "Unprocessable, compilation failed or produced no output" },
  { code: "500", meaning: "Internal server error" },
];

function TableOfContents({ sections }: { sections: EndpointSection[] }) {
  return (
    <nav
      aria-label="On this page"
      className="sticky top-8 hidden max-h-[calc(100vh-5rem)] w-52 shrink-0 self-start overflow-y-auto border-l border-border-subtle pl-5 lg:block"
    >
      <h2 className="mb-3 text-xs font-medium tracking-wide text-text-muted uppercase">
        On this page
      </h2>
      <ul className="space-y-0.5">
        {[
          ...STATIC_SECTIONS,
          ...sections.map((section) => ({
            id: sectionId(section.title),
            title: section.title,
          })),
        ].map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              className="block rounded-md px-2 py-1 text-sm text-text-secondary transition-colors duration-150 hover:bg-bg-elevated hover:text-text-primary"
            >
              {item.title}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

// ─── API Docs Page ──────────────────────────────────

export default function ApiDocsPage() {
  const [origin, setOrigin] = useState("https://your-instance.com");

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const sections = useMemo(() => getSections(origin), [origin]);

  return (
    <div className="flex items-start gap-10">
      {/* Main column. Prose caps at ~70ch; tables and code run wider. */}
      <div className="min-w-0 flex-1">
        <Link
          href="/dashboard/developers"
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-text-muted transition-colors hover:text-text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to API keys
        </Link>

        <header className="mb-8">
          <h1 className="text-2xl font-semibold text-text-primary">
            API reference
          </h1>
          <p className="mt-2 max-w-[70ch] text-sm leading-relaxed text-text-secondary">
            Compile LaTeX documents, manage projects, and upload files
            programmatically. Endpoints under{" "}
            <code className="rounded bg-bg-inset px-1.5 py-0.5 font-mono text-xs text-text-primary">
              /api/v1
            </code>{" "}
            authenticate with an API key. Dashboard endpoints authenticate with
            your signed-in session.
          </p>
        </header>

        {/* Base URLs */}
        <section className="mb-10">
          <h2 className="mb-3 text-xs font-medium tracking-wide text-text-muted uppercase">
            Base URLs
          </h2>
          <dl className="rounded-lg border border-border-subtle bg-bg-inset px-3">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-2.5">
              <dt className="w-44 shrink-0 text-xs text-text-muted">
                Public API, key auth
              </dt>
              <dd className="font-mono text-sm break-all text-text-primary">
                {origin}/api/v1
              </dd>
            </div>
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-border-subtle py-2.5">
              <dt className="w-44 shrink-0 text-xs text-text-muted">
                Dashboard, session auth
              </dt>
              <dd className="font-mono text-sm break-all text-text-primary">
                {origin}/api
              </dd>
            </div>
          </dl>
        </section>

        {/* Authentication */}
        <section id="authentication" className="mb-12 scroll-mt-8">
          <h2 className="text-lg font-semibold text-text-primary">
            Authentication
          </h2>
          <p className="mt-2 mb-4 max-w-[70ch] text-sm leading-relaxed text-text-secondary">
            Public endpoints under{" "}
            <code className="rounded bg-bg-inset px-1.5 py-0.5 font-mono text-xs text-text-primary">
              /api/v1
            </code>{" "}
            must send your API key in the{" "}
            <code className="rounded bg-bg-inset px-1.5 py-0.5 font-mono text-xs text-text-primary">
              Authorization
            </code>{" "}
            header using the Bearer scheme.
          </p>

          <CodeBlock code="Authorization: Bearer bs_YOUR_API_KEY" />

          <p className="mt-4 max-w-[70ch] text-sm leading-relaxed text-text-secondary">
            Dashboard endpoints under{" "}
            <code className="rounded bg-bg-inset px-1.5 py-0.5 font-mono text-xs text-text-primary">
              /api/ai
            </code>{" "}
            use signed session cookies from the web login and do not accept API
            keys.
          </p>
          <p className="mt-3 max-w-[70ch] text-sm leading-relaxed text-text-secondary">
            Keys are created and revoked in{" "}
            <Link
              href="/dashboard/developers"
              className="text-accent transition-colors hover:text-accent-hover"
            >
              API keys
            </Link>
            . Each account can hold up to 10.
          </p>
        </section>

        {/* Error handling */}
        <section id="errors" className="mb-12 scroll-mt-8">
          <h2 className="text-lg font-semibold text-text-primary">
            Error handling
          </h2>
          <p className="mt-2 mb-4 max-w-[70ch] text-sm leading-relaxed text-text-secondary">
            The API uses standard HTTP status codes. Every error returns a JSON
            body with a single human-readable message.
          </p>

          <CodeBlock
            code={'{\n  "error": "A human-readable error message"\n}'}
            copyable={false}
          />

          <div className="mt-4">
            <FieldTable columns={["Code", "Meaning"]}>
              {ERROR_CODES.map((row) => (
                <tr key={row.code} className="border-t border-border-subtle">
                  <td className="w-20 px-3 py-2 font-mono text-xs text-text-primary tabular-nums">
                    {row.code}
                  </td>
                  <td className="px-3 py-2 text-xs text-text-secondary">
                    {row.meaning}
                  </td>
                </tr>
              ))}
            </FieldTable>
          </div>
        </section>

        {/* Endpoint sections */}
        {sections.map((section) => (
          <section
            key={section.title}
            id={sectionId(section.title)}
            className="mb-12 scroll-mt-8"
          >
            <div className="flex items-center gap-2.5">
              <span className="text-text-muted">{section.icon}</span>
              <h2 className="text-lg font-semibold text-text-primary">
                {section.title}
              </h2>
            </div>
            <p className="mt-2 mb-4 max-w-[70ch] text-sm leading-relaxed text-text-secondary">
              {section.description}
            </p>
            <div className="space-y-2">
              {section.endpoints.map((endpoint) => (
                <EndpointCard
                  key={`${endpoint.method}-${endpoint.path}`}
                  endpoint={endpoint}
                />
              ))}
            </div>
          </section>
        ))}

        <div className="mt-12 border-t border-border-subtle pt-6">
          <Link
            href="/dashboard/developers"
            className="text-sm text-text-muted transition-colors hover:text-text-primary"
          >
            Back to API keys
          </Link>
        </div>
      </div>

      <TableOfContents sections={sections} />
    </div>
  );
}
