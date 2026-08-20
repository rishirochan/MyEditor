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
  File,
  Newspaper,
  GraduationCap,
  Presentation,
  Mail,
  Trash2,
  Pencil,
  MoreVertical,
  X,
  Check,
  Loader2,
  Filter,
  Tag,
  Globe2,
  Users,
  Search,
  CheckCircle2,
  AlertCircle,
  CircleSlash,
  CircleDashed,
  Clock3,
  type LucideIcon,
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

/** Build state is never carried by hue alone: icon + label always ship together. */
const BUILD_STATUS: Record<
  string,
  { label: string; Icon: LucideIcon; tone: string; spin?: boolean }
> = {
  success: { label: "Built", Icon: CheckCircle2, tone: "text-success" },
  error: { label: "Build failed", Icon: AlertCircle, tone: "text-error" },
  canceled: { label: "Build canceled", Icon: CircleSlash, tone: "text-text-muted" },
  compiling: { label: "Compiling", Icon: Loader2, tone: "text-warning", spin: true },
  queued: { label: "Queued", Icon: Clock3, tone: "text-warning" },
};

const NEVER_BUILT = {
  label: "Never built",
  Icon: CircleDashed,
  tone: "text-text-muted",
  spin: false,
};

function buildStatus(status: string | null) {
  return (status && BUILD_STATUS[status]) || NEVER_BUILT;
}

function BuildStatus({ status }: { status: string | null }) {
  const { label, Icon, tone, spin } = buildStatus(status);
  return (
    <span className={cn("inline-flex items-center gap-1.5", tone)}>
      <Icon className={cn("h-3.5 w-3.5 shrink-0", spin && "animate-spin")} />
      {label}
    </span>
  );
}

const TEMPLATES: {
  value: Template;
  name: string;
  hint: string;
  Icon: LucideIcon;
  wide?: boolean;
}[] = [
  {
    value: "blank",
    name: "Blank",
    hint: "One empty .tex file. Bring your own preamble.",
    Icon: File,
    wide: true,
  },
  {
    value: "article",
    name: "Article",
    hint: "Title, abstract, sections, bibliography.",
    Icon: Newspaper,
  },
  {
    value: "thesis",
    name: "Thesis",
    hint: "Front matter, chapters, appendices.",
    Icon: GraduationCap,
  },
  {
    value: "beamer",
    name: "Beamer",
    hint: "Slide deck built from frames.",
    Icon: Presentation,
  },
  {
    value: "letter",
    name: "Letter",
    hint: "Sender block, recipient, signature.",
    Icon: Mail,
  },
];

// ─── Chips ──────────────────────────────────────────

function Chip({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-md border border-border-subtle bg-bg-inset px-1.5 py-0.5 text-[11px] font-medium text-text-secondary",
        className
      )}
    >
      {children}
    </span>
  );
}

/** Private is the default, so it says nothing. Only sharing is worth a chip. */
function SharingChip({
  anyoneShared,
  sharedWithCount,
}: {
  anyoneShared: boolean;
  sharedWithCount: number;
}) {
  if (!anyoneShared && sharedWithCount === 0) return null;

  if (anyoneShared) {
    return (
      <Chip>
        <Globe2 className="h-3 w-3" />
        {sharedWithCount > 0 ? `Public, ${sharedWithCount} invited` : "Public"}
      </Chip>
    );
  }

  return (
    <Chip>
      <Users className="h-3 w-3" />
      {`Shared with ${sharedWithCount}`}
    </Chip>
  );
}

function LabelChips({ labels }: { labels: Label[] }) {
  if (labels.length === 0) return null;
  const shown = labels.slice(0, 3);

  return (
    <>
      {shown.map((label) => (
        <Chip key={label.id}>
          <Tag className="h-3 w-3 text-text-muted" />
          {label.name}
        </Chip>
      ))}
      {labels.length > shown.length && (
        <span className="text-[11px] text-text-muted tabular-nums">
          +{labels.length - shown.length}
        </span>
      )}
    </>
  );
}

// ─── Dialog frame ───────────────────────────────────
// One scrim, one panel, one header, one footer, for all four dialogs.

interface DialogFrameProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  size?: "sm" | "md";
  children: React.ReactNode;
}

function DialogFrame({
  open,
  onClose,
  title,
  description,
  size = "md",
  children,
}: DialogFrameProps) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 animate-fade-in bg-overlay"
        onClick={onClose}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "relative z-10 flex max-h-[calc(100vh-4rem)] w-full animate-slide-up flex-col overflow-hidden",
          "rounded-xl border border-border bg-bg-elevated shadow-xl",
          size === "sm" ? "max-w-sm" : "max-w-lg"
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border-subtle px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-text-primary">{title}</h2>
            {description && (
              <p className="mt-1 text-sm text-text-muted">{description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="btn btn-ghost -mt-1 -mr-1.5 h-7 w-7 shrink-0 p-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {children}
      </div>
    </div>
  );
}

function DialogError({ message }: { message: string }) {
  return (
    <div className="mb-4 flex items-start gap-2 rounded-lg bg-error-subtle px-3 py-2.5 text-sm text-error">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

function DialogFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-end gap-2 border-t border-border-subtle px-5 py-3.5">
      {children}
    </div>
  );
}

// ─── Label picker ───────────────────────────────────

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
              placeholder="Find a label or type a new one"
              className="input pl-9"
            />
          </div>
          <button
            type="button"
            onClick={handleAddFromInput}
            disabled={!normalizedQuery || selectedNameSet.has(normalizedQueryLower)}
            className="btn btn-secondary py-2"
          >
            Add
          </button>
        </div>

        {open && (matchingLabels.length > 0 || canCreateFromQuery) && (
          <div className="absolute right-0 left-0 z-20 mt-1.5 overflow-hidden rounded-lg border border-border bg-bg-elevated p-1 shadow-lg">
            {matchingLabels.map((label) => (
              <button
                key={`LABEL_SUGGESTION__${label.id}`}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => addLabel({ id: label.id, name: label.name })}
                className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm text-text-secondary transition-colors hover:bg-bg-inset hover:text-text-primary"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Tag className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                  <span className="truncate">{label.name}</span>
                </span>
                <span className="shrink-0 text-[11px] text-text-muted">existing</span>
              </button>
            ))}
            {canCreateFromQuery && (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => addLabel({ name: normalizedQuery })}
                className="mt-1 flex w-full items-center justify-between gap-3 rounded-md border-t border-border-subtle px-2 py-1.5 text-left text-sm text-text-secondary transition-colors hover:bg-bg-inset hover:text-text-primary"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Plus className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                  <span className="truncate">Create “{normalizedQuery}”</span>
                </span>
                <span className="shrink-0 text-[11px] text-text-muted">new</span>
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 pt-1">
        {selectedLabels.length === 0 && (
          <span className="text-xs text-text-muted">
            No labels yet. Labels group projects on the dashboard.
          </span>
        )}
        {selectedLabels.map((label, index) => (
          <Chip key={`SELECTED_LABEL__${label.id ?? label.name}__${index}`} className="pr-1">
            {label.name}
            <button
              type="button"
              onClick={() => removeLabel(index)}
              aria-label={`Remove label ${label.name}`}
              className="inline-flex h-4 w-4 items-center justify-center rounded text-text-muted transition-colors hover:bg-bg-elevated hover:text-text-primary"
            >
              <X className="h-3 w-3" />
            </button>
          </Chip>
        ))}
      </div>
    </div>
  );
}

// ─── Template picker ────────────────────────────────

function TemplatePicker({
  value,
  onChange,
}: {
  value: Template;
  onChange: (next: Template) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Template" className="grid gap-2 sm:grid-cols-2">
      {TEMPLATES.map(({ value: templateValue, name, hint, Icon, wide }) => {
        const selected = templateValue === value;

        return (
          <button
            key={templateValue}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(templateValue)}
            className={cn(
              "flex items-start gap-2.5 rounded-lg border p-2.5 text-left transition-colors duration-150",
              wide && "sm:col-span-2",
              selected
                ? "border-accent-muted bg-accent-subtle"
                : "border-border bg-bg-inset hover:border-border-strong"
            )}
          >
            <Icon
              className={cn(
                "mt-0.5 h-4 w-4 shrink-0",
                selected ? "text-accent" : "text-text-muted"
              )}
            />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-text-primary">
                {name}
              </span>
              <span className="mt-0.5 block text-xs text-text-muted">{hint}</span>
            </span>
            {selected && <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" />}
          </button>
        );
      })}
    </div>
  );
}

// ─── Field ──────────────────────────────────────────

function Field({
  htmlFor,
  label,
  optional,
  children,
}: {
  htmlFor: string;
  label: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="mb-1.5 block text-sm font-medium text-text-secondary"
      >
        {label}
        {optional && (
          <span className="ml-1.5 text-xs font-normal text-text-muted">optional</span>
        )}
      </label>
      {children}
    </div>
  );
}

// ─── Loading skeleton ───────────────────────────────

const SKELETON_WIDTHS = ["w-52", "w-40", "w-64", "w-44", "w-56"];

function SkeletonList() {
  return (
    <div className="panel divide-y divide-border-subtle overflow-hidden">
      {SKELETON_WIDTHS.map((width, i) => (
        <div key={i} className="flex animate-pulse-soft items-start gap-4 px-4 py-3.5">
          <div className="min-w-0 flex-1 space-y-2">
            <div className={cn("h-4 rounded bg-bg-elevated", width)} />
            <div className="h-3 w-28 rounded bg-bg-elevated" />
          </div>
          <div className="h-3 w-14 shrink-0 rounded bg-bg-elevated" />
        </div>
      ))}
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
        setError(data.error || "The project could not be created.");
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
      setError("The server did not respond. Check that MyEditor is running, then try again.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <DialogFrame
      open={open}
      onClose={onClose}
      title="New project"
      description="A project is one document: its .tex sources, its build settings, and its PDF output."
    >
      <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {error && <DialogError message={error} />}

          <Field htmlFor="project-name" label="Project name">
            <input
              id="project-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="Thesis chapter 3"
              className="input"
            />
          </Field>

          <Field htmlFor="project-description" label="Description" optional>
            <textarea
              id="project-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this document is, so future you knows"
              rows={2}
              className="input resize-none"
            />
          </Field>

          <div>
            <span className="mb-1.5 block text-sm font-medium text-text-secondary">
              Template
            </span>
            <TemplatePicker value={template} onChange={setTemplate} />
          </div>

          <Field htmlFor="project-engine" label="Engine">
            <Select
              value={engine}
              onValueChange={(value) => setEngine(value as EngineOption)}
            >
              <SelectTrigger id="project-engine" className="w-full bg-bg-inset">
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
            <p className="mt-1.5 text-xs text-text-muted">
              Auto-detect reads the preamble. You can change this later in project settings.
            </p>
          </Field>

          <Field htmlFor="labels" label="Labels" optional>
            <LabelPicker
              inputId="labels"
              selectedLabels={labels}
              defaultLabels={defaultLabels}
              onChange={setLabels}
            />
          </Field>
        </div>

        <DialogFooter>
          <button type="button" onClick={onClose} className="btn btn-ghost px-3 py-2">
            Cancel
          </button>
          <button
            type="submit"
            disabled={creating || !name.trim()}
            className="btn btn-primary px-4 py-2"
          >
            {creating && <Loader2 className="h-4 w-4 animate-spin" />}
            {creating ? "Creating" : "Create project"}
          </button>
        </DialogFooter>
      </form>
    </DialogFrame>
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
  return (
    <DialogFrame open={open} onClose={onClose} title="Delete project" size="sm">
      <div className="px-5 py-4">
        <p className="text-sm text-text-secondary">
          <span className="font-medium text-text-primary">{projectName}</span> and
          every file in it will be removed. Compiled PDFs and build history go with
          it. This cannot be undone.
        </p>
      </div>

      <DialogFooter>
        <button
          type="button"
          onClick={onClose}
          disabled={deleting}
          className="btn btn-ghost px-3 py-2"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={deleting}
          className="btn btn-danger px-4 py-2"
        >
          {deleting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Deleting
            </>
          ) : (
            <>
              <Trash2 className="h-4 w-4" />
              Delete project
            </>
          )}
        </button>
      </DialogFooter>
    </DialogFrame>
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
        setError(payload.error || "The project could not be updated.");
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
      setError(err instanceof Error ? err.message : "The project could not be updated.");
    } finally {
      setSaving(false);
    }
  }

  if (!project) return null;

  return (
    <DialogFrame open={open} onClose={onClose} title="Project details">
      <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {error && <DialogError message={error} />}

          <Field htmlFor="edit-project-name" label="Project name">
            <input
              id="edit-project-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={255}
              className="input"
            />
          </Field>

          <Field htmlFor="edit-project-description" label="Description" optional>
            <textarea
              id="edit-project-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="What this document is, so future you knows"
              className="input resize-none"
            />
          </Field>

          <Field htmlFor="edit-project-labels" label="Labels" optional>
            <LabelPicker
              inputId="edit-project-labels"
              selectedLabels={labels}
              defaultLabels={defaultLabels}
              onChange={setLabels}
            />
          </Field>
        </div>

        <DialogFooter>
          <button type="button" onClick={onClose} className="btn btn-ghost px-3 py-2">
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || !name.trim()}
            className="btn btn-primary px-4 py-2"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? "Saving" : "Save changes"}
          </button>
        </DialogFooter>
      </form>
    </DialogFrame>
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
    <DialogFrame
      open={open}
      onClose={onClose}
      title="Filter by label"
      description="A project has to carry every label you pick."
      size="sm"
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {labels.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-text-muted">
            You have no labels yet. Add one while creating or editing a project.
          </div>
        ) : (
          <div className="space-y-1.5">
            {labels.map((label) => {
              const selected = isSelected(label);

              return (
                <button
                  key={label.id}
                  type="button"
                  role="checkbox"
                  aria-checked={selected}
                  onClick={() => toggleLabel(label)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors duration-150",
                    selected
                      ? "border-accent-muted bg-accent-subtle text-text-primary"
                      : "border-border bg-bg-inset text-text-secondary hover:border-border-strong hover:text-text-primary"
                  )}
                >
                  <Tag
                    className={cn(
                      "h-3.5 w-3.5 shrink-0",
                      selected ? "text-accent" : "text-text-muted"
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {label.name}
                  </span>
                  {selected && <Check className="h-4 w-4 shrink-0 text-accent" />}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <DialogFooter>
        <button
          type="button"
          onClick={() => setSelectedLabels([])}
          disabled={selectedLabels.length === 0}
          className="btn btn-ghost mr-auto px-3 py-2"
        >
          Clear selection
        </button>
        <button type="button" onClick={onClose} className="btn btn-ghost px-3 py-2">
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onSubmit(selectedLabels)}
          className="btn btn-primary px-4 py-2"
        >
          Apply filter
        </button>
      </DialogFooter>
    </DialogFrame>
  );
}

// ─── Project row menu ───────────────────────────────

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
        aria-label="Project actions"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(!open);
        }}
        className={cn(
          "btn btn-ghost h-7 w-7 rounded-md p-0 text-text-muted",
          "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 max-sm:opacity-100",
          open && "bg-bg-inset text-text-primary opacity-100"
        )}
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
          <div className="absolute right-0 top-full z-20 mt-1 min-w-[150px] rounded-lg border border-border bg-bg-elevated p-1 shadow-lg">
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setOpen(false);
                onEdit();
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-text-secondary transition-colors hover:bg-bg-inset hover:text-text-primary"
            >
              <Pencil className="h-3.5 w-3.5" />
              Rename
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setOpen(false);
                onDelete();
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-error transition-colors hover:bg-error-subtle"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Project rows ───────────────────────────────────

function ProjectMeta({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
      {children}
    </div>
  );
}

function UpdatedAt({ value }: { value: string }) {
  return (
    <time
      dateTime={value}
      title={new Date(value).toLocaleString()}
      className="mt-0.5 w-20 shrink-0 text-right text-xs text-text-muted tabular-nums"
    >
      {formatRelativeDate(value)}
    </time>
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

  const filterActive = filteredLabels.length > 0;

  return (
    <>
      {/* Page header */}
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text-primary">
            Projects
          </h1>
          <p className="mt-1.5 text-sm text-text-secondary">
            Everything you write, plus what others have shared with you.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowNewDialog(true)}
          className="btn btn-primary px-4 py-2"
        >
          <Plus className="h-4 w-4" />
          New project
        </button>
      </header>

      {/* Toolbar: quiet until a filter is on */}
      {(labels.length > 0 || filterActive) && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowFilterDialog(true)}
            className={cn(
              "btn py-1.5",
              filterActive
                ? "border border-accent-muted bg-accent-subtle text-accent"
                : "btn-ghost"
            )}
          >
            <Filter className="h-3.5 w-3.5" />
            {filterActive ? `Filtered by ${filteredLabels.length}` : "Filter"}
          </button>

          {filterActive && (
            <>
              <div className="flex flex-wrap items-center gap-1.5">
                {filteredLabels.map((label) => (
                  <Chip key={label.id}>
                    <Tag className="h-3 w-3 text-text-muted" />
                    {label.name}
                  </Chip>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setFilteredLabels([])}
                className="btn btn-ghost py-1.5 text-xs"
              >
                <X className="h-3.5 w-3.5" />
                Clear
              </button>
            </>
          )}

          {!loading && projects.length > 0 && (
            <span className="ml-auto text-xs text-text-muted tabular-nums">
              {filterActive
                ? `${filteredProjects.length} of ${projects.length}`
                : `${projects.length} ${projects.length === 1 ? "project" : "projects"}`}
            </span>
          )}
        </div>
      )}

      {/* Loading */}
      {loading && <SkeletonList />}

      {/* First run: teach what a project is */}
      {!loading && projects.length === 0 && (
        <div className="panel px-6 py-12 sm:px-10">
          <div className="max-w-xl">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-accent-muted bg-accent-subtle">
              <FileText className="h-5 w-5 text-accent" />
            </div>
            <h2 className="mt-4 text-lg font-semibold text-text-primary">
              Write your first document
            </h2>
            <p className="mt-2 text-sm text-text-secondary">
              A project holds one document: its .tex sources, any figures it needs,
              and the engine it compiles with. Open one and you get the editor, a
              live PDF preview, and the build log side by side.
            </p>
            <p className="mt-3 text-sm text-text-secondary">
              Start from Blank if you already have a preamble, or pick a template
              that is close to what you are writing:
            </p>
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
              {TEMPLATES.map(({ value, name, Icon }) => (
                <li
                  key={value}
                  className="inline-flex items-center gap-1.5 text-xs text-text-muted"
                >
                  <Icon className="h-3.5 w-3.5" />
                  {name}
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => setShowNewDialog(true)}
              className="btn btn-primary mt-6 px-4 py-2"
            >
              <Plus className="h-4 w-4" />
              New project
            </button>
          </div>
        </div>
      )}

      {/* Project list */}
      {!loading && filteredProjects.length > 0 && (
        <ul className="panel divide-y divide-border-subtle overflow-hidden">
          {filteredProjects.map((project) => (
            <li key={project.id} className="group relative">
              <Link
                href={`/editor/${project.id}`}
                className="flex items-start gap-4 py-3 pr-11 pl-4 transition-colors duration-150 hover:bg-bg-elevated"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-sm font-medium text-text-primary transition-colors group-hover:text-accent">
                      {project.name}
                    </h3>
                    <SharingChip
                      anyoneShared={project.anyoneShared}
                      sharedWithCount={project.sharedWithCount}
                    />
                    <LabelChips labels={project.labels} />
                  </div>

                  {project.description && (
                    <p className="mt-1 line-clamp-1 text-xs text-text-secondary">
                      {project.description}
                    </p>
                  )}

                  <ProjectMeta>
                    <BuildStatus status={project.lastBuildStatus} />
                    <span className="font-mono">{project.engine}</span>
                  </ProjectMeta>
                </div>

                <UpdatedAt value={project.updatedAt} />
              </Link>

              <div className="absolute top-3 right-2">
                <CardMenu
                  onEdit={() => setEditTarget(project)}
                  onDelete={() => setDeleteTarget(project)}
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Filter matched nothing */}
      {!loading && filteredProjects.length === 0 && projects.length > 0 && (
        <div className="panel px-6 py-12 text-center">
          <Filter className="mx-auto h-5 w-5 text-text-muted" />
          <h2 className="mt-3 text-sm font-semibold text-text-primary">
            No project carries all of these labels
          </h2>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-text-secondary">
            A project has to match every label in the filter. Drop one to widen the
            search.
          </p>
          <div className="mt-5 flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => setFilteredLabels([])}
              className="btn btn-secondary px-3 py-2"
            >
              <X className="h-4 w-4" />
              Clear filter
            </button>
            <button
              type="button"
              onClick={() => setShowFilterDialog(true)}
              className="btn btn-ghost px-3 py-2"
            >
              <Filter className="h-4 w-4" />
              Edit filter
            </button>
          </div>
        </div>
      )}

      {/* Shared with me */}
      {!loading && sharedProjects.length > 0 && (
        <section className="mt-10">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="text-xs font-medium tracking-wide text-text-muted uppercase">
              Shared with me
            </h2>
            <span className="text-xs text-text-muted tabular-nums">
              {sharedProjects.length}
            </span>
          </div>

          <ul className="panel divide-y divide-border-subtle overflow-hidden">
            {sharedProjects.map((project) => (
              <li key={project.id} className="group">
                <Link
                  href={`/editor/${project.id}`}
                  className="flex items-start gap-4 px-4 py-3 transition-colors duration-150 hover:bg-bg-elevated"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-sm font-medium text-text-primary transition-colors group-hover:text-accent">
                        {project.name}
                      </h3>
                      <Chip>
                        {project.role === "editor" ? (
                          <Pencil className="h-3 w-3 text-text-muted" />
                        ) : (
                          <FileText className="h-3 w-3 text-text-muted" />
                        )}
                        {project.role === "editor" ? "Can edit" : "Read only"}
                      </Chip>
                    </div>

                    {project.description && (
                      <p className="mt-1 line-clamp-1 text-xs text-text-secondary">
                        {project.description}
                      </p>
                    )}

                    <ProjectMeta>
                      <BuildStatus status={project.lastBuildStatus} />
                      <span className="font-mono">{project.engine}</span>
                      <span>by {project.ownerName}</span>
                    </ProjectMeta>
                  </div>

                  <UpdatedAt value={project.updatedAt} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
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
      />
    </>
  );
}
