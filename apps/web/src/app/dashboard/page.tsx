"use client";

import { useState, useEffect, useCallback, type FormEvent, useMemo, useRef } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils/cn";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  FileText,
  Clock,
  Trash2,
  Pencil,
  MoreVertical,
  X,
  Loader2,
  Filter,
  Tag,
  Lock,
  Globe2,
  Search,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────
interface PrimitiveLabel {
  name: string;
}

interface LabelDraft {
  id?: string;
  name: string;
}

interface Label extends PrimitiveLabel {
  id: string;
  createdAt: string;
  userId : string;
}

interface Project {
  id: string;
  name: string;
  description: string | null;
  engine: string;
  mainFile: string;
  lastBuildStatus: string | null;
  sharedWithCount: number;
  anyoneShared: boolean;
  isShared: boolean;
  createdAt: string;
  updatedAt: string;
  labels : Label[];
}

interface SharedProject {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  engine: string;
  mainFile: string;
  createdAt: string;
  updatedAt: string;
  ownerName: string;
  ownerEmail: string;
  role: "viewer" | "editor";
  lastBuildStatus: string | null;
}


type Template = "blank" | "article" | "thesis" | "beamer" | "letter";
type EngineOption = "auto" | "pdflatex" | "xelatex" | "lualatex" | "latex";

// ─── Helpers ────────────────────────────────────────

function formatRelativeDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function buildStatusColor(status: string | null): string {
  switch (status) {
    case "success":
      return "bg-success";
    case "error":
      return "bg-error";
    case "canceled":
      return "bg-text-muted";
    case "compiling":
    case "queued":
      return "bg-warning";
    default:
      return "bg-text-muted";
  }
}

function buildStatusLabel(status: string | null): string {
  switch (status) {
    case "success":
      return "Built successfully";
    case "error":
      return "Build failed";
    case "canceled":
      return "Build canceled";
    case "compiling":
      return "Compiling";
    case "queued":
      return "Queued";
    default:
      return "No builds";
  }
}

interface LabelPickerProps {
  inputId: string;
  selectedLabels: LabelDraft[];
  defaultLabels: Label[];
  onChange: (labels: LabelDraft[]) => void;
}

function LabelPicker({
  inputId,
  selectedLabels,
  defaultLabels,
  onChange,
}: LabelPickerProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  const selectedNameSet = useMemo(
    () =>
      new Set(
        selectedLabels.map((label) => label.name.trim().toLowerCase())
      ),
    [selectedLabels]
  );

  const availableLabels = useMemo(
    () =>
      defaultLabels.filter(
        (label) => !selectedNameSet.has(label.name.trim().toLowerCase())
      ),
    [defaultLabels, selectedNameSet]
  );

  const normalizedQuery = query.trim();
  const normalizedQueryLower = normalizedQuery.toLowerCase();

  const matchingLabels = useMemo(() => {
    const pool = normalizedQueryLower
      ? availableLabels.filter((label) =>
          label.name.toLowerCase().includes(normalizedQueryLower)
        )
      : availableLabels;
    return pool.slice(0, 6);
  }, [availableLabels, normalizedQueryLower]);

  const exactMatch = useMemo(
    () =>
      availableLabels.find(
        (label) => label.name.trim().toLowerCase() === normalizedQueryLower
      ),
    [availableLabels, normalizedQueryLower]
  );

  const canCreateFromQuery =
    normalizedQuery.length > 0 &&
    !selectedNameSet.has(normalizedQueryLower) &&
    !exactMatch;

  const addLabel = useCallback(
    (nextLabel: LabelDraft) => {
      const normalizedName = nextLabel.name.trim();
      if (!normalizedName) return;
      if (selectedNameSet.has(normalizedName.toLowerCase())) return;

      onChange([
        ...selectedLabels,
        {
          id: nextLabel.id,
          name: normalizedName,
        },
      ]);
      setQuery("");
      setOpen(false);
    },
    [onChange, selectedLabels, selectedNameSet]
  );

  const removeLabel = useCallback(
    (index: number) => {
      onChange(selectedLabels.filter((_, i) => i !== index));
    },
    [onChange, selectedLabels]
  );

  const handleAddFromInput = useCallback(() => {
    if (!normalizedQuery) return;
    if (exactMatch) {
      addLabel({ id: exactMatch.id, name: exactMatch.name });
      return;
    }
    if (canCreateFromQuery) {
      addLabel({ name: normalizedQuery });
    }
  }, [addLabel, canCreateFromQuery, exactMatch, normalizedQuery]);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  return (
    <div className="space-y-2">
      <div ref={wrapperRef} className="relative">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <input
              id={inputId}
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddFromInput();
                }
              }}
              placeholder="Search existing labels or add a new one"
              className="w-full rounded-lg border border-border bg-bg-secondary py-2 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent"
            />
          </div>
          <button
            type="button"
            onClick={handleAddFromInput}
            disabled={!normalizedQuery || selectedNameSet.has(normalizedQueryLower)}
            className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-bg-primary transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            Add
          </button>
        </div>

        {open && (matchingLabels.length > 0 || canCreateFromQuery) && (
          <div className="absolute left-0 right-0 z-20 mt-2 overflow-hidden rounded-lg border border-border bg-bg-secondary shadow-lg">
            {matchingLabels.map((label) => (
              <button
                key={`LABEL_SUGGESTION__${label.id}`}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => addLabel({ id: label.id, name: label.name })}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-text-secondary transition-colors hover:bg-bg-elevated hover:text-text-primary"
              >
                <span>{label.name}</span>
                <span className="text-xs text-text-muted">existing</span>
              </button>
            ))}
            {canCreateFromQuery && (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => addLabel({ name: normalizedQuery })}
                className="flex w-full items-center justify-between border-t border-border px-3 py-2 text-left text-sm text-text-secondary transition-colors hover:bg-bg-elevated hover:text-text-primary"
              >
                <span>Create “{normalizedQuery}”</span>
                <span className="text-xs text-text-muted">new</span>
              </button>
            )}
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {selectedLabels.length === 0 && (
          <span className="text-xs text-text-muted">No labels selected.</span>
        )}
        {selectedLabels.map((label, index) => (
          <span
            key={`SELECTED_LABEL__${label.id ?? label.name}__${index}`}
            className="inline-flex items-center rounded-full bg-bg-elevated px-2.5 py-0.5 text-xs font-medium text-text-secondary"
          >
            {label.name}
            <button
              type="button"
              onClick={() => removeLabel(index)}
              className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-bg-secondary hover:text-text-primary"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Skeleton Card ──────────────────────────────────

function SkeletonCard() {
  return (
    <div className="rounded-lg border border-border bg-bg-secondary p-5 animate-pulse">
      <div className="flex items-start justify-between">
        <div className="h-5 w-40 rounded bg-bg-elevated" />
        <div className="h-5 w-5 rounded bg-bg-elevated" />
      </div>
      <div className="mt-3 h-4 w-full rounded bg-bg-elevated" />
      <div className="mt-1 h-4 w-3/4 rounded bg-bg-elevated" />
      <div className="mt-4 flex items-center gap-4">
        <div className="h-5 w-16 rounded-full bg-bg-elevated" />
        <div className="h-4 w-20 rounded bg-bg-elevated" />
        <div className="h-4 w-24 rounded bg-bg-elevated" />
      </div>
    </div>
  );
}

// ─── New Project Dialog ─────────────────────────────

interface NewProjectDialogProps {
  open: boolean;
  defaultLabels : Label[];
  onClose: () => void;
  onCreated: () => void;
}

function NewProjectDialog({ open, defaultLabels, onClose, onCreated }: NewProjectDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [template, setTemplate] = useState<Template>("blank");
  const [labels, setLabels] = useState<LabelDraft[]>([]);
  const [engine, setEngine] = useState<EngineOption>("auto");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  function resetForm() {
    setName("");
    setDescription("");
    setTemplate("blank");
    setLabels([]);
    setEngine("auto");
    setError("");
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setCreating(true);

    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description, template, engine }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to create project");
        return;
      }

      // Attach all the labels specified
      const { project } = await res.json();
      await Promise.all(
        labels.map((label) =>
          fetch(`/api/labels/attach`, {
            method: "PUT",
            body: JSON.stringify({ labelName: label.name, projectId: project.id }),
            headers: { "Content-Type": "application/json" },
          })
        )
      );

      resetForm();
      onCreated();
      onClose();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setCreating(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="relative z-10 w-full max-w-lg rounded-lg border border-border bg-bg-primary p-6 shadow-xl">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-text-primary">
            New Project
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-text-muted transition-colors hover:text-text-primary hover:bg-bg-elevated"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-lg bg-error/10 px-4 py-3 text-sm text-error">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div>
            <label
              htmlFor="project-name"
              className="mb-1.5 block text-sm font-medium text-text-secondary"
            >
              Project name
            </label>
            <input
              id="project-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="My LaTeX Document"
              className="w-full rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent"
            />
          </div>

          {/* Description */}
          <div>
            <label
              htmlFor="project-description"
              className="mb-1.5 block text-sm font-medium text-text-secondary"
            >
              Description
              <span className="ml-1 text-text-muted font-normal">
                (optional)
              </span>
            </label>
            <textarea
              id="project-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="A brief description of your project"
              rows={3}
              className="w-full rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent resize-none"
            />
          </div>

          {/* Template */}
          <div>
            <label
              htmlFor="project-template"
              className="mb-1.5 block text-sm font-medium text-text-secondary"
            >
              Template
            </label>
            <Select
              value={template}
              onValueChange={(value) => setTemplate(value as Template)}
            >
              <SelectTrigger id="project-template" className="w-full">
                <SelectValue placeholder="Select template" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="blank">Blank</SelectItem>
                <SelectItem value="article">Article</SelectItem>
                <SelectItem value="thesis">Thesis</SelectItem>
                <SelectItem value="beamer">Beamer (Presentation)</SelectItem>
                <SelectItem value="letter">Letter</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          {/* Engine */}
          <div>
            <label
              htmlFor="project-engine"
              className="mb-1.5 block text-sm font-medium text-text-secondary"
            >
              Engine
            </label>
            <Select
              value={engine}
              onValueChange={(value) => setEngine(value as EngineOption)}
            >
              <SelectTrigger id="project-engine" className="w-full">
                <SelectValue placeholder="Select engine" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto-detect</SelectItem>
                <SelectItem value="pdflatex">pdfLaTeX</SelectItem>
                <SelectItem value="xelatex">XeLaTeX</SelectItem>
                <SelectItem value="lualatex">LuaLaTeX</SelectItem>
                <SelectItem value="latex">LaTeX (DVI)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Labels */}
          <div>
              <label
                htmlFor="labels"
                className="mb-1.5 block text-sm font-medium text-text-secondary"
              >
                Labels
              </label>
              <LabelPicker
                inputId="labels"
                selectedLabels={labels}
                defaultLabels={defaultLabels}
                onChange={setLabels}
              />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border bg-bg-elevated px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-border"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creating || !name.trim()}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg-primary transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {creating ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating...
                </span>
              ) : (
                "Create Project"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Delete Confirmation Dialog ─────────────────────

interface DeleteDialogProps {
  open: boolean;
  projectName: string;
  onClose: () => void;
  onConfirm: () => void;
  deleting: boolean;
}

function DeleteDialog({
  open,
  projectName,
  onClose,
  onConfirm,
  deleting,
}: DeleteDialogProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-sm rounded-lg border border-border bg-bg-primary p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-text-primary">
          Delete Project
        </h2>
        <p className="mt-2 text-sm text-text-secondary">
          Are you sure you want to delete{" "}
          <span className="font-medium text-text-primary">{projectName}</span>?
          This action cannot be undone.
        </p>
        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={deleting}
            className="rounded-lg border border-border bg-bg-elevated px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-border disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={deleting}
            className="rounded-lg bg-error px-4 py-2 text-sm font-medium text-bg-primary transition-colors hover:bg-error/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {deleting ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Deleting...
              </span>
            ) : (
              "Delete"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Edit Project Dialog ───────────────────────────

interface EditProjectDialogProps {
  open: boolean;
  project: Project | null;
  defaultLabels: Label[];
  onClose: () => void;
  onUpdated: () => void;
}

function EditProjectDialog({
  open,
  project,
  defaultLabels,
  onClose,
  onUpdated,
}: EditProjectDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [labels, setLabels] = useState<LabelDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !project) return;
    setName(project.name);
    setDescription(project.description ?? "");
    setLabels(project.labels.map((label) => ({ id: label.id, name: label.name })));
    setError("");
  }, [open, project]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!project) return;

    setSaving(true);
    setError("");

    try {
      const updateRes = await fetch(`/api/projects/${project.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: description.trim() }),
      });

      if (!updateRes.ok) {
        const payload = await updateRes.json().catch(() => ({}));
        setError(payload.error || "Failed to update project");
        return;
      }

      const originalByName = new Map(
        project.labels.map((label) => [label.name.trim().toLowerCase(), label])
      );
      const selectedByName = new Map(
        labels.map((label) => [label.name.trim().toLowerCase(), label])
      );

      const labelsToRemove = project.labels.filter(
        (label) => !selectedByName.has(label.name.trim().toLowerCase())
      );
      const labelsToAdd = labels.filter(
        (label) => !originalByName.has(label.name.trim().toLowerCase())
      );

      await Promise.all(
        labelsToRemove.map(async (label) => {
          const detachRes = await fetch("/api/labels/detach", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectId: project.id, labelId: label.id }),
          });
          if (!detachRes.ok && detachRes.status !== 404) {
            const payload = await detachRes.json().catch(() => ({}));
            throw new Error(payload.error || `Failed to detach ${label.name}`);
          }
        })
      );

      await Promise.all(
        labelsToAdd.map(async (label) => {
          const attachRes = await fetch("/api/labels/attach", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectId: project.id, labelName: label.name }),
          });
          if (!attachRes.ok && attachRes.status !== 409) {
            const payload = await attachRes.json().catch(() => ({}));
            throw new Error(payload.error || `Failed to attach ${label.name}`);
          }
        })
      );

      onUpdated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update project");
    } finally {
      setSaving(false);
    }
  }

  if (!open || !project) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative z-10 w-full max-w-lg rounded-lg border border-border bg-bg-primary p-6 shadow-xl">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-text-primary">Edit Project</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-text-muted transition-colors hover:text-text-primary hover:bg-bg-elevated"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-lg bg-error/10 px-4 py-3 text-sm text-error">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="edit-project-name"
              className="mb-1.5 block text-sm font-medium text-text-secondary"
            >
              Project name
            </label>
            <input
              id="edit-project-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={255}
              className="w-full rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent"
            />
          </div>

          <div>
            <label
              htmlFor="edit-project-description"
              className="mb-1.5 block text-sm font-medium text-text-secondary"
            >
              Description
              <span className="ml-1 text-text-muted font-normal">
                (optional)
              </span>
            </label>
            <textarea
              id="edit-project-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="A brief description of your project"
              className="w-full resize-none rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent"
            />
          </div>

          <div>
            <label
              htmlFor="edit-project-labels"
              className="mb-1.5 block text-sm font-medium text-text-secondary"
            >
              Labels
            </label>
            <LabelPicker
              inputId="edit-project-labels"
              selectedLabels={labels}
              defaultLabels={defaultLabels}
              onChange={setLabels}
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border bg-bg-elevated px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-border"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !name.trim()}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg-primary transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving...
                </span>
              ) : (
                "Save Changes"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}


// ─── Filter Labels Dialog ─────────────────────

interface FilterLabelsDialogProps {
  open: boolean;
  onClose: () => void;
  filteredLabels : Label[];
  labels : Label[];
  onSubmit : (labels: Label[]) => void;
}

function FilterLabelsDialog({
  open,
  onClose,
  filteredLabels,
  labels,
  onSubmit
}: FilterLabelsDialogProps) {
  const [selectedLabels, setSelectedLabels] = useState<Label[]>(filteredLabels);

  useEffect(() => {
    setSelectedLabels(filteredLabels);
  }, [filteredLabels, open]);

  if (!open) return null;

  const toggleLabel = (label: Label) => {
    setSelectedLabels((prev) => {
      const exists = prev.some((l) => l.id === label.id);
      if (exists) return prev.filter((l) => l.id !== label.id);
      return [...prev, label];
    });
  };

  const isSelected = (label: Label) =>
    selectedLabels.some((l) => l.id === label.id);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative z-10 w-full max-w-sm rounded-lg border border-border bg-bg-primary p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-text-primary">
          Filter Labels
        </h2>

        <p className="mt-1 text-sm text-text-muted">
          Select one or more labels to filter projects.
        </p>

        <div className="mt-4 max-h-72 overflow-y-auto pr-1">
          {labels.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-bg-secondary/50 px-3 py-6 text-center text-sm text-text-muted">
              No labels available.
            </div>
          ) : (
            <div className="space-y-3">
              {labels.map((label) => {
                const selected = isSelected(label);

                return (
                  <button
                    key={label.id}
                    type="button"
                    onClick={() => toggleLabel(label)}
                    className={`w-full rounded-lg border px-3 py-2 text-left text-sm font-medium transition-colors ${
                      selected
                        ? "border-accent bg-accent/20 text-text-primary"
                        : "border-border bg-bg-primary text-text-secondary hover:bg-bg-secondary"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Tag className="h-4 w-4"/>
                      <span>{label.name}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>


        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-border bg-bg-primary px-4 py-2 text-sm font-medium text-text-secondary transition-colors hover:bg-bg-secondary"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={() => onSubmit(selectedLabels)}
            className="flex-1 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg-primary transition-colors hover:bg-accent-hover"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Project Card Menu ──────────────────────────────

interface CardMenuProps {
  onEdit: () => void;
  onDelete: () => void;
}

function CardMenu({ onEdit, onDelete }: CardMenuProps) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className="relative"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(!open);
        }}
        className="rounded-md p-1 text-text-muted transition-colors hover:text-text-primary hover:bg-bg-elevated"
      >
        <MoreVertical className="h-4 w-4" />
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
            }}
          />
          <div className="absolute right-0 top-full z-20 mt-1 min-w-[140px] rounded-lg border border-border bg-bg-secondary py-1 shadow-lg">
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setOpen(false);
                onEdit();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-text-primary transition-colors hover:bg-bg-elevated"
            >
              <Pencil className="h-4 w-4" />
              Edit
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setOpen(false);
                onDelete();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-error transition-colors hover:bg-bg-elevated"
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Dashboard Page ─────────────────────────────────

export default function DashboardPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [sharedProjects, setSharedProjects] = useState<SharedProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [showFilterDialog, setShowFilterDialog] = useState(false);
  const [editTarget, setEditTarget] = useState<Project | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [labels, setLabels] = useState<Label[]>([]);
  const [filteredLabels, setFilteredLabels] = useState<Label[]>([]);

  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch("/api/projects", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setProjects(data.projects);
        setSharedProjects(data.sharedProjects ?? []);
      }
    } catch {
      // Silently fail -- user sees empty state
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchLabels = useCallback(async () => {
    try {
      const res = await fetch("/api/labels", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setLabels(data.labels);
      }
    } catch {
      // Silently fail -- user sees no labels
    }
  }, []);

  const fetchAll = useCallback(() => {
    fetchProjects();
    fetchLabels();
  }, [fetchProjects, fetchLabels]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      fetchAll();
    }, 10_000);

    return () => clearInterval(interval);
  }, [fetchAll]);

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);

    try {
      const res = await fetch(`/api/projects/${deleteTarget.id}`, {
        method: "DELETE",
      });

      if (res.ok) {
        setProjects((prev) => prev.filter((p) => p.id !== deleteTarget.id));
      }
    } catch {
      // Silently fail
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }

  const filteredProjects = useMemo(() => {
    if (filteredLabels.length === 0) return projects;
    return projects.filter((project) =>
      filteredLabels.every((label) =>
        project.labels.some((projectLabel) => projectLabel.id === label.id)
      )
    );
  }, [filteredLabels, projects]);

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">My Projects</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Manage your LaTeX documents
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
          type="button"
          onClick={() => setShowFilterDialog(true)}
          className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-bg-primary transition-colors hover:bg-accent-hover"
        >
          <Filter className="h-4 w-4" />
          
          {filteredLabels.length > 0 && (<span>Filter Labels ({filteredLabels.length})</span>)}
          {filteredLabels.length === 0 && (<span>Filter Labels</span>)}
        </button>
        <button
          type="button"
          onClick={() => setShowNewDialog(true)}
          className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-bg-primary transition-colors hover:bg-accent-hover"
        >
          <Plus className="h-4 w-4" />
          New Project
        </button>
        </div>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && projects.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-bg-secondary/50 px-6 py-16">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-bg-elevated">
            <FileText className="h-7 w-7 text-text-muted" />
          </div>
          <h3 className="mt-4 text-lg font-medium text-text-primary">
            No projects yet
          </h3>
          <p className="mt-1 text-sm text-text-secondary">
            Create your first project to get started.
          </p>
          <button
            type="button"
            onClick={() => setShowNewDialog(true)}
            className="mt-6 flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-bg-primary transition-colors hover:bg-accent-hover"
          >
            <Plus className="h-4 w-4" />
            New Project
          </button>
        </div>
      )}

      {/* Project Grid */}
      {!loading && filteredProjects.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredProjects.map((project) => (
            <Link
              key={project.id}
              href={`/editor/${project.id}`}
              className="group rounded-lg border border-border bg-bg-secondary p-5 transition-colors hover:bg-bg-elevated/50 hover:border-accent/30"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <FileText className="h-4 w-4 shrink-0 text-accent" />
                  <h3 className="truncate text-sm font-semibold text-text-primary group-hover:text-accent">
                    {project.name}
                  </h3>
                </div>
                <CardMenu
                  onEdit={() => setEditTarget(project)}
                  onDelete={() => setDeleteTarget(project)}
                />
              </div>

              {project.description && (
                <p className="mt-2 line-clamp-2 text-sm text-text-secondary">
                  {project.description}
                </p>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-3">
                {/* Engine badge */}
                <span className="inline-flex items-center rounded-full bg-bg-elevated px-2.5 py-0.5 text-xs font-medium text-text-secondary">
                  {project.engine}
                </span>

                {/* Label Badges */}
                {project.labels.map((label) => (
                  <span key={label.id} className="inline-flex items-center rounded-full bg-bg-elevated px-2.5 py-0.5 text-xs font-medium text-text-secondary">
                  {label.name}
                </span>
                ))}


                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
                    project.anyoneShared || project.sharedWithCount > 0
                      ? "border-red-500/25 bg-red-500/10 text-red-300"
                      : "border-border bg-bg-elevated text-text-muted"
                  )}
                >
                  {project.anyoneShared || project.sharedWithCount > 0 ? (
                    <Globe2 className="h-3 w-3" />
                  ) : (
                    <Lock className="h-3 w-3" />
                  )}
                  {project.anyoneShared
                    ? project.sharedWithCount > 0
                      ? `Public +${project.sharedWithCount}`
                      : "Public"
                    : project.sharedWithCount > 0
                      ? `Shared ${project.sharedWithCount}`
                      : "Private"}
                </span>

                {/* Build status */}
                <span className="inline-flex items-center gap-1.5 text-xs text-text-muted">
                  <span
                    className={cn(
                      "h-2 w-2 rounded-full",
                      buildStatusColor(project.lastBuildStatus)
                    )}
                    title={buildStatusLabel(project.lastBuildStatus)}
                  />
                  {buildStatusLabel(project.lastBuildStatus)}
                </span>

                {/* Updated date */}
                <span className="inline-flex items-center gap-1 text-xs text-text-muted ml-auto">
                  <Clock className="h-3 w-3" />
                  {formatRelativeDate(project.updatedAt)}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {!loading && filteredProjects.length === 0 && projects.length > 0 && 
        (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-bg-secondary/50 px-6 py-16">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-bg-elevated">
            <Filter className="h-7 w-7 text-text-muted" />
          </div>
          <h3 className="mt-4 text-lg font-medium text-text-primary">
            Your filter returned no results
          </h3>
          <p className="mt-1 text-sm text-text-secondary">
            Please refine your search, or create a project which matches the selected labels.
          </p>
          <button
            type="button"
            onClick={() => setShowFilterDialog(true)}
            className="mt-6 flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-bg-primary transition-colors hover:bg-accent-hover"
          >
            <Filter className="h-4 w-4" />
            Filter Labels
          </button>
          <button
            type="button"
            onClick={() => setShowNewDialog(true)}
            className="mt-6 flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-bg-primary transition-colors hover:bg-accent-hover"
          >
            <Plus className="h-4 w-4" />
            New Project
          </button>
          </div>
        )
      }

      {/* Shared with me section */}
      {!loading && sharedProjects.length > 0 && (
        <div className="mt-10">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-text-primary">
              Shared with me
            </h2>
            <p className="mt-0.5 text-sm text-text-secondary">
              Projects others have shared with you
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sharedProjects.map((project) => (
              <Link
                key={project.id}
                href={`/editor/${project.id}`}
                className="group rounded-lg border border-border bg-bg-secondary p-5 transition-colors hover:bg-bg-elevated/50 hover:border-accent/30"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="h-4 w-4 shrink-0 text-accent" />
                    <h3 className="truncate text-sm font-semibold text-text-primary group-hover:text-accent">
                      {project.name}
                    </h3>
                  </div>
                  <span className="shrink-0 inline-flex items-center rounded-full bg-bg-elevated px-2 py-0.5 text-[10px] font-medium text-text-muted border border-border">
                    {project.role === "editor" ? "Editor" : "Viewer"}
                  </span>
                </div>

                {project.description && (
                  <p className="mt-2 line-clamp-2 text-sm text-text-secondary">
                    {project.description}
                  </p>
                )}

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  {/* Engine badge */}
                  <span className="inline-flex items-center rounded-full bg-bg-elevated px-2.5 py-0.5 text-xs font-medium text-text-secondary">
                    {project.engine}
                  </span>

                  {/* Owner info */}
                  <span className="inline-flex items-center gap-1 text-xs text-text-muted">
                    by {project.ownerName}
                  </span>

                  {/* Build status */}
                  <span className="inline-flex items-center gap-1.5 text-xs text-text-muted">
                    <span
                      className={cn(
                        "h-2 w-2 rounded-full",
                        buildStatusColor(project.lastBuildStatus)
                      )}
                      title={buildStatusLabel(project.lastBuildStatus)}
                    />
                    {buildStatusLabel(project.lastBuildStatus)}
                  </span>

                  {/* Updated date */}
                  <span className="inline-flex items-center gap-1 text-xs text-text-muted ml-auto">
                    <Clock className="h-3 w-3" />
                    {formatRelativeDate(project.updatedAt)}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Dialogs */}
      <NewProjectDialog
        open={showNewDialog}
        onClose={() => setShowNewDialog(false)}
        onCreated={fetchAll}
        defaultLabels={labels}
      />

      <EditProjectDialog
        open={editTarget !== null}
        project={editTarget}
        defaultLabels={labels}
        onClose={() => setEditTarget(null)}
        onUpdated={fetchAll}
      />

      <DeleteDialog
        open={deleteTarget !== null}
        projectName={deleteTarget?.name ?? ""}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        deleting={deleting}
      />

      <FilterLabelsDialog
        open={showFilterDialog}
        onClose={() => setShowFilterDialog(false)}
        onSubmit={filtered => {
          setFilteredLabels(filtered);
          setShowFilterDialog(false);
        }}
        filteredLabels={filteredLabels}
        labels={labels}
      >
      </FilterLabelsDialog>
    </>
  );
}
